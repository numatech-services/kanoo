import { Types } from "mongoose";
import { withTransaction } from "@/lib/db";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { PurchasePriceLogModel } from "@/models/PurchasePriceLog";
import { SupplierModel } from "@/models/Supplier";
import { BusinessRuleError } from "@/lib/errors";
import { accountForMethod, postDeskCash } from "@/lib/comptoir";
import { assertDayOpen } from "@/lib/comptoir-sale";
import { receiveInReserve, moveBetweenLevels } from "@/lib/restaurant-stock";
import { paySupplier } from "@/lib/restaurant-payables";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
interface Standing { _id: Id; itemId: Id; supplierId?: Id; supplierName?: string; unitCost: number; quantities: number[]; dailyFee?: number; toDesk: boolean; active: boolean }
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const weekday = (day: string) => new Date(`${day}T12:00:00`).getDay();
/** Référence d'une livraison permanente pour un jour : elle rend la réception et le paiement uniques. */
export const standingRef = (id: unknown, day: string) => `LIV-${day.replace(/-/g, "")}-${String(id).slice(-6).toUpperCase()}`;

/**
 * Livraisons permanentes d'un restaurant pour un jour (le pain du matin…) :
 * quantité attendue d'après le jour de la semaine, reçue ou non, payée ou non,
 * montant du jour (marchandise + frais de livraison).
 */
export async function standingDay(tenantId: string, deskId: string, day: string, costs: boolean) {
  if (!isDay(day)) throw new BusinessRuleError("Jour invalide.");
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("standingDeliveries").lean<{ standingDeliveries?: Standing[] } | null>();
  const list = (desk?.standingDeliveries ?? []).filter(s => s.active);
  if (!list.length) return [];
  const [items, logs] = await Promise.all([
    ActivityItemModel.find({ tenantId, deskId, _id: { $in: list.map(s => s.itemId) } }).select("name unit").lean<Array<{ _id: Id; name: string; unit: string }>>(),
    PurchasePriceLogModel.find({ tenantId, deskId, reference: { $in: list.map(s => standingRef(s._id, day)) } }).select("reference quantity unitCost paidFromCash").lean<Array<{ reference: string; quantity: number; unitCost: number; paidFromCash?: boolean }>>(),
  ]);
  return list.map(s => {
    const it = items.find(i => String(i._id) === String(s.itemId));
    const log = logs.find(l => l.reference === standingRef(s._id, day));
    const expected = s.quantities[weekday(day)] ?? 0;
    const amount = log ? Math.round(log.quantity * log.unitCost) + (s.dailyFee ?? 0) : null;
    return {
      _id: String(s._id), itemId: String(s.itemId), name: it?.name ?? "—", unit: it?.unit ?? "", supplier: s.supplierName ?? null, expected,
      received: log ? log.quantity : null, paid: !!log?.paidFromCash, toDesk: s.toDesk,
      ...(costs ? { unitCost: s.unitCost, dailyFee: s.dailyFee ?? 0, amount } : {}),
    };
  });
}

/** Réglage des livraisons permanentes (article, fournisseur, prix, quantités par jour, frais, montée directe au comptoir). */
export async function saveStanding(auth: TokenPayload, deskId: string, raw: unknown) {
  const list = (Array.isArray(raw) ? raw : []) as Array<Record<string, unknown>>;
  const out: Array<Record<string, unknown>> = [];
  for (const s of list.slice(0, 20)) {
    if (typeof s.itemId !== "string" || !/^[a-f0-9]{24}$/i.test(s.itemId)) continue;
    const it = await ActivityItemModel.findOne({ _id: s.itemId, tenantId: auth.tenantId, deskId }).select("name recipe").lean<{ name: string; recipe?: unknown[] } | null>();
    if (!it) throw new BusinessRuleError("Article introuvable.");
    if (it.recipe?.length) throw new BusinessRuleError(`${it.name} est une préparation : une livraison porte sur un article acheté.`);
    const q = Array.isArray(s.quantities) ? s.quantities.map(Number) : [];
    if (q.length !== 7 || q.some(n => !Number.isFinite(n) || n < 0)) throw new BusinessRuleError(`${it.name} : sept quantités (dimanche à samedi), positives ou nulles.`);
    const cost = Number(s.unitCost);
    if (!(cost > 0)) throw new BusinessRuleError(`${it.name} : prix unitaire obligatoire.`);
    const sup = typeof s.supplierId === "string" && /^[a-f0-9]{24}$/i.test(s.supplierId) ? await SupplierModel.findOne({ _id: s.supplierId, tenantId: auth.tenantId }).select("name").lean<{ _id: Id; name: string } | null>() : null;
    out.push({
      _id: typeof s._id === "string" && /^[a-f0-9]{24}$/i.test(s._id) ? new Types.ObjectId(s._id) : new Types.ObjectId(),
      itemId: s.itemId, ...(sup ? { supplierId: sup._id, supplierName: sup.name } : typeof s.supplierName === "string" && s.supplierName.trim() ? { supplierName: s.supplierName.trim().slice(0, 120) } : {}),
      unitCost: cost, quantities: q, ...(Number(s.dailyFee) > 0 ? { dailyFee: Math.round(Number(s.dailyFee)) } : {}), toDesk: s.toDesk !== false, active: s.active !== false,
    });
  }
  await ActivityDeskModel.updateOne({ _id: deskId, tenantId: auth.tenantId }, { $set: { standingDeliveries: out } });
}

async function standingOf(auth: TokenPayload, deskId: string, id: string) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("standingDeliveries").lean<{ standingDeliveries?: Standing[] } | null>();
  const s = desk?.standingDeliveries?.find(x => String(x._id) === id && x.active);
  if (!s) throw new BusinessRuleError("Livraison introuvable.");
  return s;
}

/**
 * Le matin : la livraison du jour est confirmée (quantité attendue, ou
 * corrigée), entre en réserve au prix convenu et monte au comptoir si réglé
 * ainsi. Une seule réception par livraison et par jour. Non payée : elle le
 * sera le soir.
 */
export async function confirmStanding(auth: TokenPayload, deskId: string, id: string, day: string, quantity?: number) {
  if (!isDay(day)) throw new BusinessRuleError("Jour invalide.");
  const s = await standingOf(auth, deskId, id);
  const ref = standingRef(s._id, day);
  if (await PurchasePriceLogModel.exists({ tenantId: auth.tenantId, deskId, reference: ref })) throw new BusinessRuleError("Livraison du jour déjà reçue.");
  const qty = quantity === undefined ? s.quantities[weekday(day)] ?? 0 : Number(quantity);
  if (!(qty > 0)) throw new BusinessRuleError("Quantité reçue invalide (rien d'attendu ce jour-là : saisissez la quantité).");
  const at = day === new Date().toISOString().slice(0, 10) ? undefined : `${day}T08:00:00`;
  try {
    await receiveInReserve(auth, deskId, [{ itemId: String(s.itemId), quantity: qty, unitCost: s.unitCost }], { ...(s.supplierId ? { supplierId: String(s.supplierId) } : { supplier: s.supplierName }), reference: ref, standingKey: ref, dueDays: 1, ...(at ? { date: at } : {}) });
  } catch (e) {
    if ((e as { code?: number })?.code === 11000) throw new BusinessRuleError("Livraison du jour déjà reçue.");
    throw e;
  }
  if (s.toDesk) await moveBetweenLevels(auth, deskId, [{ itemId: String(s.itemId), quantity: qty }], "supply");
  return { reference: ref, quantity: qty };
}

/**
 * Le soir : le fournisseur est payé depuis la caisse du site. Le paiement
 * solde la dette créée à la réception (401) ; les frais de livraison du jour
 * sont une charge de transport. La réception du jour passe « payée en caisse »
 * (elle sort du rapprochement des factures).
 */
export async function payStanding(auth: TokenPayload, deskId: string, id: string, day: string, method = "cash") {
  if (!isDay(day)) throw new BusinessRuleError("Jour invalide.");
  const s = await standingOf(auth, deskId, id);
  const ref = standingRef(s._id, day);
  return withTransaction(async session => {
    const date = new Date(`${day}T19:00:00`);
    await assertDayOpen(auth.tenantId, deskId, date, session);
    const log = await PurchasePriceLogModel.findOneAndUpdate({ tenantId: auth.tenantId, deskId, reference: ref, paidFromCash: { $ne: true } }, { $set: { paidFromCash: true } }, { session, new: false })
      .lean<{ quantity: number; unitCost: number; purchaseId?: Types.ObjectId } | null>();
    if (!log) throw new BusinessRuleError((await PurchasePriceLogModel.exists({ tenantId: auth.tenantId, deskId, reference: ref })) ? "Livraison du jour déjà payée." : "Confirmez d'abord la livraison du jour.");
    const goods = Math.round(log.quantity * log.unitCost), who = s.supplierName ? ` — ${s.supplierName}` : "";
    // La réception a créé la dette : le paiement la solde, ce n'est pas un second achat.
    const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("treasuryAccountId").session(session ?? null).lean<{ treasuryAccountId?: unknown } | null>();
    const account = desk?.treasuryAccountId ? await accountForMethod(auth.tenantId, desk.treasuryAccountId, method, session) : undefined;
    if (log.purchaseId) await paySupplier(auth, deskId, String(log.purchaseId), { date, ...(account ? { treasuryAccountId: String(account) } : {}) }, session);
    else if (goods > 0) {
      // Reçue avant la dette à la réception : le paiement reste un achat payé en caisse.
      const [cash] = await ActivityCashEntryModel.create([{ tenantId: auth.tenantId, deskId, direction: "out", amount: goods, label: `Livraison du jour${who} (${ref})`.slice(0, 200), method: method === "orange_money" ? "orange_money" : "cash", category: "purchase", date, createdBy: auth.userId }], { session });
      await postDeskCash(auth, deskId, cash, session);
    }
    const fee = s.dailyFee ?? 0;
    if (fee > 0) {
      const [cash] = await ActivityCashEntryModel.create([{ tenantId: auth.tenantId, deskId, direction: "out", amount: fee, label: `Frais de livraison${who} (${ref})`.slice(0, 200), method: method === "orange_money" ? "orange_money" : "cash", category: "transport", date, createdBy: auth.userId }], { session });
      await postDeskCash(auth, deskId, cash, session);
    }
    return { reference: ref, goods, fee: s.dailyFee ?? 0, total: goods + (s.dailyFee ?? 0) };
  });
}

/** Une bouteille de gaz est mise en service (la précédente est vide) : la date sert à la durée d'une bouteille. */
export async function startGasBottle(auth: TokenPayload, deskId: string, at = new Date()) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("gasBottles").lean<{ gasBottles?: Array<{ startedAt: Date }> } | null>();
  const last = desk?.gasBottles?.[desk.gasBottles.length - 1];
  if (last && at.getTime() - new Date(last.startedAt).getTime() < 2 * 3_600_000) throw new BusinessRuleError("Une bouteille a déjà été mise en service il y a moins de deux heures.");
  await ActivityDeskModel.updateOne({ _id: deskId, tenantId: auth.tenantId }, { $push: { gasBottles: { $each: [{ startedAt: at, by: auth.userId }], $slice: -60 } } });
}

/**
 * Le gaz d'un mois : dépense (rubrique « gaz, carburant, autres énergies » du
 * résultat), par jour d'ouverture et par ticket ; bouteilles mises en service
 * dans le mois et durée moyenne d'une bouteille (dix dernières).
 */
export function gasStats(bottles: Array<{ startedAt: Date | string }>, month: string, spend: number, tickets: number, openDays: number) {
  const starts = bottles.map(b => new Date(b.startedAt).getTime()).sort((a, b) => a - b);
  const gaps = starts.slice(1).map((t, k) => (t - starts[k]) / 86_400_000).slice(-10);
  const inMonth = starts.filter(t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === month; }).length;
  return {
    spend: Math.round(spend), perTicket: tickets > 0 ? Math.round(spend / tickets) : null, perDay: openDays > 0 ? Math.round(spend / openDays) : null,
    bottlesInMonth: inMonth, avgBottleDays: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null,
    lastStartedAt: starts.length ? new Date(starts[starts.length - 1]).toISOString() : null,
  };
}
