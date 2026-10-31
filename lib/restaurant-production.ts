import { Types } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { DeskMenuModel } from "@/models/DeskMenu";
import { BusinessRuleError } from "@/lib/errors";
import { productionPlan, preorderedFor } from "@/lib/campus-server";
import { recordLoss } from "@/lib/spot-server";
import { restaurantStock, moveBetweenLevels } from "@/lib/restaurant-stock";
import { deskPricing } from "@/lib/restaurant-overview";
import { portionRecipe } from "@/lib/restaurant";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const oid = (v: unknown) => new Types.ObjectId(String(v));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const SERVICES = { midi: "Midi", soir: "Soir", jour: "Journée" } as const;
export type ServiceKey = keyof typeof SERVICES;

/** Bornes locales d'un jour « AAAA-MM-JJ ». */
const dayBounds = (day: string) => ({ from: new Date(`${day}T00:00:00`), to: new Date(`${day}T23:59:59.999`) });
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Ventes par article d'un jour (tickets payés). */
async function soldOn(tenantId: string, deskId: string, day: string) {
  const b = dayBounds(day);
  const rows = await ComptoirSaleModel.aggregate<{ _id: Id; q: number; tickets: number }>([
    { $match: { tenantId: oid(tenantId), deskId: oid(deskId), status: "paid", date: { $gte: b.from, $lte: b.to } } },
    { $unwind: "$lines" }, { $group: { _id: "$lines.itemId", q: { $sum: "$lines.quantity" }, tickets: { $addToSet: "$_id" } } },
    { $project: { q: 1, tickets: { $size: "$tickets" } } },
  ]);
  const tickets = await ComptoirSaleModel.countDocuments({ tenantId, deskId, status: "paid", date: { $gte: b.from, $lte: b.to } });
  return { byItem: new Map(rows.map(r => [String(r._id), r.q])), tickets };
}

/**
 * Prévision des ventes d'un jour, article par article : l'emploi du temps du
 * campus s'il est paramétré, sinon la moyenne des quatre mêmes jours de
 * semaine précédents ; jamais moins que les réservations EasyPay du jour.
 */
export async function forecastDay(tenantId: string, deskId: string, day: string) {
  const plan = await productionPlan(tenantId, deskId, day);
  if (plan.configured) {
    return { basis: "schedule" as const, tickets: null as number | null, items: new Map(plan.planned.map(p => [p.itemId, Math.ceil(p.planned)])) };
  }
  const history = await Promise.all([1, 2, 3, 4].map(w => soldOn(tenantId, deskId, addDays(day, -7 * w))));
  const avg = new Map<string, number>();
  for (const h of history) for (const [id, q] of h.byItem) avg.set(id, (avg.get(id) ?? 0) + q / history.length);
  const pre = await preorderedFor(tenantId, deskId, day);
  for (const [id, q] of pre) avg.set(id, Math.max(avg.get(id) ?? 0, q));
  return { basis: "history" as const, tickets: Math.round(history.reduce((t, h) => t + h.tickets, 0) / history.length), items: new Map([...avg].map(([id, q]) => [id, Math.ceil(q)])) };
}

export interface NeedRow { itemId: string; name: string; unit: string; needed: number; desk: number; reserve: number; toSupply: number; toBuy: number; packSize?: number }

/**
 * Plan du jour : quantités à produire (le menu s'il est saisi, sinon la
 * prévision), ingrédients nécessaires (fiches techniques, quantités brutes)
 * comparés au stock du comptoir et de la réserve — ce qu'il faut monter de la
 * réserve (bon de sortie) et ce qu'il faut acheter ; coût du menu.
 */
export async function dayPlan(tenantId: string, deskId: string, day: string, costs: boolean) {
  const [items, fc, menus, stock, pricing] = await Promise.all([
    ActivityItemModel.find({ tenantId, deskId, archived: { $ne: true } }).select("name unit category salePrice recipe portions pack").lean<Array<{ _id: Id; name: string; unit: string; category?: string; salePrice?: number; portions?: number; pack?: { size?: number }; recipe?: Array<{ itemId: Id; quantity: number; yield?: number }> }>>(),
    forecastDay(tenantId, deskId, day),
    DeskMenuModel.find({ tenantId, deskId, day }).lean<Array<{ _id: Id; service: ServiceKey; lines: Array<{ itemId: Id; quantity: number }>; note?: string; issuedRef?: string; closing?: { at: Date; lines: Array<{ itemId: Id; produced: number; sold: number; leftover: number; leftoverValue?: number }> } }>>(),
    restaurantStock(tenantId, deskId, costs),
    costs ? deskPricing(tenantId, deskId).catch(() => null) : Promise.resolve(null),
  ]);
  const byId = new Map(items.map(i => [String(i._id), i]));
  const stockBy = new Map(stock.rows.map(r => [r.itemId, r]));
  const costBy = new Map((pricing?.rows ?? []).map(r => [r.itemId, r.cost]));
  // À produire : la somme des menus du jour s'il y en a, sinon la prévision.
  const planned = new Map<string, number>();
  if (menus.length) for (const m of menus) for (const l of m.lines) planned.set(String(l.itemId), (planned.get(String(l.itemId)) ?? 0) + l.quantity);
  else for (const [id, q] of fc.items) if (byId.has(id)) planned.set(id, q);
  const need = new Map<string, number>();
  for (const [id, q] of planned) {
    const it = byId.get(id);
    if (it?.recipe?.length) for (const r of portionRecipe(it.recipe, it.portions)) need.set(String(r.itemId), (need.get(String(r.itemId)) ?? 0) + r.quantity * q);
    else need.set(id, (need.get(id) ?? 0) + q);
  }
  const needs: NeedRow[] = [...need].map(([id, q]) => {
    const it = byId.get(id), st = stockBy.get(id);
    const desk = st?.desk ?? 0, reserve = Math.max(0, (st?.reserve ?? 0) - (st?.expiredQty ?? 0));
    const missing = Math.max(0, q - desk), toSupply = r3(Math.min(missing, reserve));
    return { itemId: id, name: it?.name ?? "—", unit: it?.unit ?? "", needed: r3(q), desk, reserve, toSupply, toBuy: r3(Math.max(0, missing - reserve)), ...(it?.pack?.size ? { packSize: it.pack.size } : {}) };
  }).sort((a, b) => b.toBuy - a.toBuy || b.toSupply - a.toSupply || a.name.localeCompare(b.name));
  const dishes = [...planned].map(([id, q]) => {
    const it = byId.get(id), c = costBy.get(id) ?? null;
    return { itemId: id, name: it?.name ?? "—", category: it?.category, forecast: fc.items.get(id) ?? 0, planned: q, unitCost: costs ? c : null, cost: costs && c !== null && c !== undefined ? Math.round(c * q) : null, priceTTC: it?.salePrice ?? 0 };
  }).sort((a, b) => b.planned - a.planned);
  const portions = dishes.reduce((t, d) => t + d.planned, 0);
  const menuCost = costs && dishes.every(d => d.cost !== null) ? dishes.reduce((t, d) => t + (d.cost ?? 0), 0) : null;
  return {
    day, basis: fc.basis, expectedTickets: fc.tickets, dishes, needs, portions,
    menuCost, costPerPortion: menuCost !== null && portions ? Math.round(menuCost / portions) : null,
    menus: menus.map(m => ({ ...m, _id: String(m._id), lines: m.lines.map(l => ({ itemId: String(l.itemId), quantity: l.quantity })), closing: m.closing ? { ...m.closing, lines: m.closing.lines.map(l => ({ ...l, itemId: String(l.itemId), leftoverValue: costs ? l.leftoverValue : undefined })) } : undefined })),
    menuItems: items.filter(i => (i.salePrice ?? 0) > 0).map(i => ({ itemId: String(i._id), name: i.name, category: i.category, preparation: !!i.recipe?.length })),
  };
}

/** Enregistre le menu d'un service (remplace le précédent tant que le service n'est pas clos). */
export async function saveMenu(auth: TokenPayload, deskId: string, day: string, service: ServiceKey, lines: Array<{ itemId: string; quantity: number }>, note?: string) {
  const ids = lines.map(l => l.itemId);
  const ok = await ActivityItemModel.countDocuments({ _id: { $in: ids }, tenantId: auth.tenantId, deskId });
  if (ok !== new Set(ids).size) throw new BusinessRuleError("Article du menu introuvable sur ce comptoir.");
  const cur = await DeskMenuModel.findOne({ tenantId: auth.tenantId, deskId, day, service }).select("closing").lean<{ closing?: { at?: Date } } | null>();
  if (cur?.closing?.at) throw new BusinessRuleError("Service déjà clos : son menu ne se modifie plus.");
  const clean = lines.filter(l => Number(l.quantity) > 0).map(l => ({ itemId: oid(l.itemId), quantity: Math.round(Number(l.quantity)) }));
  await DeskMenuModel.updateOne({ tenantId: auth.tenantId, deskId, day, service },
    { $set: { lines: clean, ...(note !== undefined ? { note: String(note).slice(0, 400) } : {}) }, $setOnInsert: { createdBy: auth.userId } }, { upsert: true });
}

/**
 * Bon de sortie de la réserve vers le comptoir (la cuisine) pour le plan du
 * jour : monte ce qui manque au comptoir, dans la limite de la réserve (lots
 * non périmés, les plus proches de leur date d'abord).
 */
export async function issueForDay(auth: TokenPayload, deskId: string, day: string) {
  const plan = await dayPlan(auth.tenantId, deskId, day, false);
  const lines = plan.needs.filter(n => n.toSupply > 0).map(n => ({ itemId: n.itemId, quantity: n.toSupply }));
  if (!lines.length) throw new BusinessRuleError("Rien à monter de la réserve : le comptoir a déjà ce qu'il faut (ou la réserve est vide).");
  const r = await moveBetweenLevels(auth, deskId, lines, "supply");
  await DeskMenuModel.updateMany({ tenantId: auth.tenantId, deskId, day }, { $set: { issuedRef: r.reference } });
  return { reference: r.reference, lines: lines.length, toBuy: plan.needs.filter(n => n.toBuy > 0) };
}

/**
 * Fin de service : pour chaque plat du menu, produit, vendu (tickets du jour)
 * et restes. Les restes sont passés en perte « invendus » : leurs ingrédients
 * sortent du stock au coût de la fiche technique.
 */
export async function closeService(auth: TokenPayload, deskId: string, day: string, service: ServiceKey, lines: Array<{ itemId: string; produced: number; leftover: number }>) {
  const menu = await DeskMenuModel.findOne({ tenantId: auth.tenantId, deskId, day, service });
  if (!menu) throw new BusinessRuleError("Aucun menu pour ce service : saisissez-le d'abord.");
  if (menu.closing?.at) throw new BusinessRuleError("Service déjà clos.");
  const { byItem } = await soldOn(auth.tenantId, deskId, day);
  const out: Array<{ itemId: Id; produced: number; sold: number; leftover: number; leftoverValue: number }> = [];
  await withTransaction(async session => {
    out.length = 0;
    for (const l of lines) {
      if (!menu.lines.some((m: { itemId: Id }) => String(m.itemId) === String(l.itemId))) continue;
      const produced = Math.max(0, Math.round(Number(l.produced) || 0)), leftover = Math.max(0, Math.round(Number(l.leftover) || 0));
      if (leftover > produced) throw new BusinessRuleError("Les restes ne peuvent pas dépasser ce qui a été produit.");
      let value = 0;
      if (leftover > 0) value = (await recordLoss(auth, { deskId, itemId: l.itemId, quantity: leftover, reason: "unsold", note: `Fin du service ${SERVICES[service].toLowerCase()} du ${new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR")}`, lenient: true }, session)).lossValue;
      out.push({ itemId: oid(l.itemId), produced, sold: byItem.get(String(l.itemId)) ?? 0, leftover, leftoverValue: value });
    }
    const claimed = await DeskMenuModel.updateOne({ _id: menu._id, "closing.at": { $exists: false } }, { $set: { closing: { at: new Date(), by: auth.userId, lines: out } } }, { session });
    if (claimed.modifiedCount !== 1) throw new BusinessRuleError("Service déjà clos.");
  });
  return { lines: out.length, leftoverValue: out.reduce((t, l) => t + l.leftoverValue, 0) };
}
