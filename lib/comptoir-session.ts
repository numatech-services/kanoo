import { Types, type ClientSession } from "mongoose";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { CashSessionModel } from "@/models/CashSession";
import { CashClosingModel } from "@/models/CashClosing";
import { BusinessRuleError } from "@/lib/errors";
import { closeDay, localDay } from "@/lib/comptoir-sale";
import type { TokenPayload } from "@/lib/auth";

export { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (d: string) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + 1); return localDay(x); };

export interface ProductRow { itemId: string; label: string; category?: string; quantity: number; revenueTTC: number; revenueHT: number; cost: number; margin: number; valued: boolean; tickets: number }

/** Ventes par article sur une période (tickets payés), triées par chiffre d'affaires. */
export async function productSales(tenantId: string, deskId: unknown, fromDay: string, toDay: string, session?: ClientSession): Promise<ProductRow[]> {
  const rows = await ComptoirSaleModel.aggregate<{ _id: Types.ObjectId; label: string; category?: string; quantity: number; ttc: number; ht: number; cost: number; margin: number; unvalued: number; tickets: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), deskId: new Types.ObjectId(String(deskId)), status: "paid", date: { $gte: new Date(`${fromDay}T00:00:00.000`), $lte: new Date(`${toDay}T23:59:59.999`) } } },
    { $unwind: "$lines" },
    { $group: {
      _id: "$lines.itemId", label: { $last: "$lines.label" }, category: { $last: "$lines.category" },
      quantity: { $sum: "$lines.quantity" }, ttc: { $sum: "$lines.totalTTC" }, ht: { $sum: "$lines.totalHT" },
      cost: { $sum: "$lines.costTotal" }, margin: { $sum: { $ifNull: ["$lines.marginHT", 0] } },
      unvalued: { $sum: { $cond: [{ $eq: ["$lines.marginHT", null] }, 1, 0] } }, tickets: { $sum: 1 },
    } },
    { $sort: { ttc: -1 } },
  ]).session(session ?? null);
  return rows.map(r => ({
    itemId: String(r._id), label: r.label, category: r.category, quantity: r.quantity, revenueTTC: r.ttc, revenueHT: r.ht,
    cost: r.cost, margin: Math.round(r.margin), valued: r.unvalued === 0, tickets: r.tickets,
  }));
}

/**
 * Bilan d'une période de caisse : chiffre d'affaires (tickets), recettes et
 * dépenses (par moyen, par nature), solde, espèces attendues, marge,
 * palmarès, ventes par jour.
 */
export async function periodReport(tenantId: string, deskId: unknown, fromDay: string, toDay: string, openingFloat = 0) {
  const tid = new Types.ObjectId(tenantId), did = new Types.ObjectId(String(deskId));
  const range = { $gte: new Date(`${fromDay}T00:00:00.000`), $lte: new Date(`${toDay}T23:59:59.999`) };
  const [entries, sales, byDay, products] = await Promise.all([
    ActivityCashEntryModel.aggregate<{ _id: { d: string; m: string; c: string | null; t: boolean }; total: number; n: number }>([
      { $match: { tenantId: tid, deskId: did, date: range } },
      { $group: { _id: { d: "$direction", m: "$method", c: { $ifNull: ["$category", null] }, t: { $gt: ["$saleId", null] } }, total: { $sum: "$amount" }, n: { $sum: 1 } } },
    ]),
    ComptoirSaleModel.aggregate<{ n: number; ttc: number; ht: number; cost: number; margin: number }>([
      { $match: { tenantId: tid, deskId: did, status: "paid", date: range } },
      { $group: { _id: null, n: { $sum: 1 }, ttc: { $sum: "$totalTTC" }, ht: { $sum: "$totalHT" }, cost: { $sum: "$costTotal" }, margin: { $sum: "$marginHT" } } },
    ]),
    ComptoirSaleModel.aggregate<{ _id: string; ttc: number; margin: number; n: number }>([
      { $match: { tenantId: tid, deskId: did, status: "paid", date: range } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: "Africa/Niamey" } }, ttc: { $sum: "$totalTTC" }, margin: { $sum: "$marginHT" }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    productSales(tenantId, deskId, fromDay, toDay),
  ]);
  const s = sales[0] ?? { n: 0, ttc: 0, ht: 0, cost: 0, margin: 0 };
  const sum = (pred: (e: (typeof entries)[number]) => boolean) => entries.filter(pred).reduce((t, e) => t + e.total, 0);
  const receipts = sum(e => e._id.d === "in");
  const expenses = sum(e => e._id.d === "out");
  const methods = [...new Set(entries.map(e => e._id.m))].map(m => ({
    method: m, receipts: sum(e => e._id.m === m && e._id.d === "in"), expenses: sum(e => e._id.m === m && e._id.d === "out"),
  }));
  const cats = [...new Set(entries.filter(e => e._id.d === "out").map(e => e._id.c ?? "other"))].map(c => ({
    category: c, label: EXPENSE_CATEGORIES[c] ?? c, amount: sum(e => e._id.d === "out" && (e._id.c ?? "other") === c),
  })).sort((a, b) => b.amount - a.amount);
  const cash = methods.find(m => m.method === "cash");
  const valued = products.filter(p => p.valued);
  return {
    fromDay, toDay,
    sales: { count: s.n, revenueTTC: s.ttc, revenueHT: s.ht, cost: s.cost, margin: Math.round(s.margin), averageTicket: s.n ? Math.round(s.ttc / s.n) : 0,
      markupRate: s.ht > 0 ? Math.round((s.margin / s.ht) * 1000) / 10 : null },
    receipts, expenses, balance: receipts - expenses,
    otherReceipts: sum(e => e._id.d === "in" && !e._id.t),
    byMethod: methods, expensesByCategory: cats,
    openingFloat, expectedCash: openingFloat + (cash?.receipts ?? 0) - (cash?.expenses ?? 0),
    byDay: byDay.map(d => ({ day: d._id, revenueTTC: d.ttc, margin: Math.round(d.margin), tickets: d.n })),
    topByRevenue: products.slice(0, 10),
    topByQuantity: [...products].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    topByMargin: [...valued].sort((a, b) => b.margin - a.margin).slice(0, 10),
    losses: valued.filter(p => p.margin < 0),
  };
}

/** Ouvre la caisse d'un comptoir (une seule ouverte à la fois). */
export async function openSession(auth: TokenPayload, input: { deskId: string; openingFloat: number; day?: string; label?: string }) {
  const day = input.day && DAY.test(input.day) ? input.day : localDay(new Date());
  if (day > localDay(new Date())) throw new BusinessRuleError("On n'ouvre pas une caisse à une date à venir.");
  const float = Math.round(Number(input.openingFloat));
  if (!(float >= 0)) throw new BusinessRuleError("Fonds de caisse invalide.");
  if (await CashSessionModel.exists({ tenantId: auth.tenantId, deskId: input.deskId, status: "open" })) throw new BusinessRuleError("Une caisse est déjà ouverte pour ce comptoir : fermez-la d'abord.");
  if (await CashClosingModel.exists({ tenantId: auth.tenantId, deskId: input.deskId, day: { $gte: day } })) throw new BusinessRuleError("Cette journée est déjà arrêtée : ouvrez la caisse à partir du jour suivant.");
  try {
    return await CashSessionModel.create({ tenantId: auth.tenantId, deskId: input.deskId, openDay: day, openingFloat: float, label: input.label?.slice(0, 80), openedBy: auth.userId });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new BusinessRuleError("Une caisse est déjà ouverte pour ce comptoir.");
    throw e;
  }
}

/**
 * Ferme la caisse : comptage des espèces, arrêté de la période (écart passé
 * en 658 / 758), jours verrouillés, chiffres figés. Si des journées ont déjà
 * été arrêtées pendant la période, l'arrêté repart du lendemain de la
 * dernière, avec les espèces qu'elle avait comptées.
 */
export async function closeSession(auth: TokenPayload, sessionId: string, input: { countedCash: number; notes?: string; day?: string }, session?: ClientSession) {
  const cs = await CashSessionModel.findOne({ _id: sessionId, tenantId: auth.tenantId }).session(session ?? null);
  if (!cs) throw new BusinessRuleError("Caisse introuvable.");
  if (cs.status !== "open") throw new BusinessRuleError("Cette caisse est déjà fermée.");
  const day = input.day && DAY.test(input.day) ? input.day : localDay(new Date());
  if (day < cs.openDay) throw new BusinessRuleError("La fermeture précède l'ouverture.");
  const last = await CashClosingModel.findOne({ tenantId: auth.tenantId, deskId: cs.deskId, day: { $gte: cs.openDay } }).sort({ day: -1 }).session(session ?? null)
    .lean<{ _id: Types.ObjectId; day: string; countedCash: number } | null>();
  let closingId = last && last.day === day ? last._id : null;
  if (!closingId) {
    const closing = await closeDay(auth, {
      deskId: String(cs.deskId), day, fromDay: last ? nextDay(last.day) : cs.openDay, sessionId: cs._id,
      countedCash: input.countedCash, openingFloat: last ? last.countedCash : cs.openingFloat, notes: input.notes,
    }, session);
    closingId = closing._id;
  }
  const report = await periodReport(auth.tenantId, cs.deskId, cs.openDay, day, cs.openingFloat);
  const closings = await CashClosingModel.find({ tenantId: auth.tenantId, deskId: cs.deskId, day: { $gte: cs.openDay, $lte: day } }).select("gap countedCash").session(session ?? null).lean<Array<{ gap: number; countedCash: number }>>();
  const claim = await CashSessionModel.updateOne({ _id: cs._id, status: "open" }, { $set: {
    status: "closed", closeDay: day, closedBy: auth.userId, closingId,
    summary: { ...report, countedCash: last && last.day === day ? last.countedCash : Math.round(Number(input.countedCash)), gap: closings.reduce((t, c) => t + c.gap, 0) },
  } }, { session });
  if (claim.modifiedCount !== 1) throw new BusinessRuleError("Cette caisse vient d'être fermée.");
  return CashSessionModel.findById(cs._id).session(session ?? null).lean();
}
