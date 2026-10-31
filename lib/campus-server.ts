import { Types } from "mongoose";
import { DeskScheduleModel } from "@/models/DeskSchedule";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { portionRecipe } from "@/lib/restaurant";
import { ActivityItemModel } from "@/models/ActivityItem";
import { DeskPreorderModel } from "@/models/DeskPreorder";
import { withPreorders } from "@/lib/easypay";
import { localDay } from "@/lib/comptoir-sale";
import { learnRates, forecastDay, presenceFor, DEFAULT_SERVICES, type Schedule, type SaleFact } from "@/lib/campus";

/** Historique servant à apprendre la consommation par personne. */
export const LEARN_DAYS = 28;

const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };

/** Emploi du temps du comptoir, ou null s'il n'est pas renseigné. */
export async function loadSchedule(tenantId: string, deskId: string): Promise<Schedule | null> {
  const s = await DeskScheduleModel.findOne({ tenantId, deskId }).lean<Schedule | null>();
  if (!s || !(s.courses?.length || s.services?.some(v => (v.base ?? 0) > 0))) return null;
  return { services: s.services?.length ? s.services : DEFAULT_SERVICES, courses: s.courses ?? [], periods: s.periods ?? [], safetyMargin: s.safetyMargin ?? 0.1 };
}

/** Lignes vendues (tickets payés) d'une période : instant, article, quantité. */
export async function saleFacts(tenantId: string, deskId: string, fromDay: string, toDay: string): Promise<SaleFact[]> {
  const rows = await ComptoirSaleModel.aggregate<{ date: Date; itemId: Types.ObjectId; quantity: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), deskId: new Types.ObjectId(deskId), status: "paid", date: { $gte: new Date(`${fromDay}T00:00:00.000`), $lte: new Date(`${toDay}T23:59:59.999`) } } },
    { $unwind: "$lines" },
    { $project: { date: 1, itemId: "$lines.itemId", quantity: "$lines.quantity" } },
  ]);
  return rows.map(r => ({ at: new Date(r.date), itemId: String(r.itemId), quantity: r.quantity }));
}

type ItemLite = { _id: Types.ObjectId; name: string; unit: string; quantity: number; salePrice?: number; unitCost: number; portions?: number; recipe?: Array<{ itemId: Types.ObjectId; quantity: number; yield?: number }> };

/** Consommation apprise sur les 28 jours qui précèdent `day`. */
async function rates(tenantId: string, deskId: string, s: Schedule, day: string) {
  // Jusqu'à la veille du jour prévu, et jamais au-delà d'hier (un jour pas
  // encore écoulé a sa présence mais pas encore ses ventes).
  const yesterday = addDays(localDay(new Date()), -1);
  const to = addDays(day, -1) < yesterday ? addDays(day, -1) : yesterday, from = addDays(to, -(LEARN_DAYS - 1));
  return learnRates(await saleFacts(tenantId, deskId, from, to), s, from, to).rates;
}

/** Ventes prévues → besoins en articles stockés (les préparations deviennent leurs ingrédients). */
function expand(total: Map<string, number>, items: Map<string, ItemLite>) {
  const need = new Map<string, number>();
  for (const [id, q] of total) {
    const it = items.get(id);
    if (it?.recipe?.length) for (const r of portionRecipe(it.recipe, it.portions)) need.set(String(r.itemId), (need.get(String(r.itemId)) ?? 0) + r.quantity * q);
    else need.set(id, (need.get(id) ?? 0) + q);
  }
  return need;
}

/** Quantités déjà pré-commandées (appli EasyPay) pour un jour, par article. */
export async function preorderedFor(tenantId: string, deskId: string, day: string) {
  const rows = await DeskPreorderModel.aggregate<{ _id: Types.ObjectId; q: number; n: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), deskId: new Types.ObjectId(deskId), pickupDay: day, status: { $in: ["booked", "ready"] } } },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.itemId", q: { $sum: "$lines.quantity" }, n: { $sum: 1 } } },
  ]);
  return new Map(rows.map(r => [String(r._id), r.q]));
}

/**
 * Plan de production d'un jour : présence attendue par service, articles à
 * préparer, ingrédients nécessaires comparés au stock (manques), et aperçu
 * des 7 jours suivants (présence, chiffre d'affaires attendu).
 */
export async function productionPlan(tenantId: string, deskId: string, day: string) {
  const s = await loadSchedule(tenantId, deskId);
  const itemsArr = await ActivityItemModel.find({ tenantId, deskId, archived: { $ne: true } })
    .select("name unit quantity salePrice unitCost recipe portions").lean<ItemLite[]>();
  const items = new Map(itemsArr.map(i => [String(i._id), i]));
  const name = (id: string) => items.get(id)?.name ?? "—";
  // Pré-commandes de l'appli : préparées quoi qu'il arrive.
  const pre = await preorderedFor(tenantId, deskId, day);
  const preorders = [...pre.entries()].map(([itemId, quantity]) => ({ itemId, name: name(itemId), unit: items.get(itemId)?.unit ?? "", quantity })).sort((a, b) => b.quantity - a.quantity);
  if (!s) return { configured: false as const, day, preorders };
  const r = await rates(tenantId, deskId, s, day);
  const f = forecastDay(new Date(`${day}T12:00:00`), s, r);
  const planned = withPreorders(f.total, pre);
  const need = expand(new Map(planned.map(p => [p.itemId, p.planned])), items);
  const ingredients = [...need.entries()].map(([id, q]) => {
    const it = items.get(id);
    const quantity = Math.round(q * 1000) / 1000;
    return { itemId: id, name: name(id), unit: it?.unit ?? "", needed: quantity, stock: it?.quantity ?? 0, missing: Math.max(0, Math.round((quantity - (it?.quantity ?? 0)) * 1000) / 1000) };
  }).sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
  const week = [];
  for (let k = 0; k < 7; k++) {
    const d = addDays(day, k), date = new Date(`${d}T12:00:00`);
    const fd = k === 0 ? f : forecastDay(date, s, r);
    week.push({
      day: d,
      services: s.services.map(sv => ({ key: sv.key, presence: presenceFor(date, sv, s).presence })),
      periods: fd.byService[0]?.periods.map(p => p.label) ?? [],
      expectedRevenue: Math.round([...fd.total.entries()].reduce((t, [id, q]) => t + q * (items.get(id)?.salePrice ?? 0), 0)),
    });
  }
  return {
    configured: true as const, day, safetyMargin: s.safetyMargin ?? 0.1, learnedFromDays: LEARN_DAYS, learnedItems: new Set([...r.keys()].map(k => k.split("|")[0])).size,
    services: f.byService.map(b => ({
      key: b.service.key, label: b.service.label, from: b.service.from, to: b.service.to, presence: b.presence, groups: b.groups, factor: b.factor,
      periods: b.periods.map(p => p.label),
      items: b.items.map(i => ({ ...i, name: name(i.itemId), unit: items.get(i.itemId)?.unit ?? "", prepared: !!items.get(i.itemId)?.recipe?.length })).sort((a, b) => b.quantity - a.quantity),
    })),
    ingredients, shortfall: ingredients.filter(i => i.missing > 0), week,
    preorders,
    // Par article : prévision, déjà pré-commandé, à préparer (le plus grand des deux).
    planned: planned.map(p => ({ ...p, name: name(p.itemId), unit: items.get(p.itemId)?.unit ?? "" })).sort((a, b) => b.planned - a.planned),
  };
}

/**
 * Demande prévue sur `days` jours à partir de `fromDay` (articles stockés,
 * ingrédients des préparations compris), d'après l'emploi du temps. Null si
 * le comptoir n'a pas d'emploi du temps ou pas encore d'historique.
 */
export async function scheduledDemand(tenantId: string, deskId: string, fromDay: string, days: number): Promise<Map<string, number> | null> {
  const s = await loadSchedule(tenantId, deskId);
  if (!s) return null;
  const r = await rates(tenantId, deskId, s, fromDay);
  if (!r.size) return null;
  const itemsArr = await ActivityItemModel.find({ tenantId, deskId }).select("name unit quantity recipe portions unitCost").lean<ItemLite[]>();
  const items = new Map(itemsArr.map(i => [String(i._id), i]));
  const total = new Map<string, number>();
  for (let k = 0; k < days; k++) {
    for (const [id, q] of forecastDay(new Date(Date.parse(`${addDays(fromDay, k)}T12:00:00`)), s, r).total) total.set(id, (total.get(id) ?? 0) + q);
  }
  return expand(total, items);
}

