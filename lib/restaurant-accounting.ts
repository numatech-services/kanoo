import { Types } from "mongoose";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { CashClosingModel } from "@/models/CashClosing";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { DeskFundingModel } from "@/models/DeskFunding";
import { DeskMonthCloseModel } from "@/models/DeskMonthClose";
import { DeskWeekCloseModel } from "@/models/DeskWeekClose";
import { DeskTransferModel } from "@/models/DeskTransfer";
import { PurchaseModel } from "@/models/Purchase";
import { PurchasePriceLogModel } from "@/models/PurchasePriceLog";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { accountBalance } from "@/lib/treasury";
import { productSales } from "@/lib/comptoir-session";
import { deskMonthResult, maskPayroll } from "@/lib/restaurant-result";
import { deskPricing } from "@/lib/restaurant-overview";
import { localDay } from "@/lib/format";

type Id = Types.ObjectId;
const oid = (v: unknown) => new Types.ObjectId(String(v));
const INTERNAL = ["funding", "cash_transfer"];
const CATEGORY_LABELS: Record<string, string> = { ...EXPENSE_CATEGORIES, purchase: "Achats de marchandises", supplier_payment: "Règlements fournisseurs", funding: "Dotation du site", cash_transfer: "Remise / virement interne", non_sale: "Entrée hors vente", easypay_topup: "Recharge EasyPay" };
export const bounds = (from: string, to: string) => ({ $gte: new Date(`${from}T00:00:00`), $lte: new Date(`${to}T23:59:59.999`) });

export interface JournalRow { date: string; deskId: string; site: string; kind: "sale" | "in" | "out" | "internal" | "invoice"; label: string; category: string; method: string; party: string | null; piece: string | null; sale: number; receipt: number; expense: number; status: string | null }
const MAX_ROWS = 5000;
/** Vendu sans encaissement en caisse : l'ardoise se règle plus tard, la carte est due par Numatech. */
const NOT_CASHED = ["credit", "easypay"];
const CASH_INTERNAL = [...INTERNAL, "easypay_topup"];

/**
 * Journal d'activité d'un périmètre (ce n'est pas le livre-journal comptable) :
 * ventes du jour par moyen de paiement, entrées et sorties d'argent, factures
 * et règlements fournisseurs. Vendre et encaisser sont deux colonnes : une
 * vente à l'ardoise n'est encaissée qu'à son règlement. Les mouvements internes
 * (dotations, remises, recharges EasyPay) y figurent sans compter.
 */
export async function journal(tenantId: string, deskIds: string[], from: string, to: string, f: { category?: string; method?: string } = {}) {
  const ids = deskIds.map(oid), range = bounds(from, to);
  const desks = new Map((await ActivityDeskModel.find({ tenantId, _id: { $in: ids } }).select("name").lean<Array<{ _id: Id; name: string }>>()).map(d => [String(d._id), d.name]));
  const [cash, sales, invoices, paid] = await Promise.all([
    ActivityCashEntryModel.find({ tenantId, deskId: { $in: ids }, date: range, saleId: { $exists: false } }).sort({ date: -1 }).limit(MAX_ROWS).lean<Array<{ _id: Id; deskId: Id; date: Date; direction: string; amount: number; label: string; method: string; category?: string; movementId?: Id }>>(),
    ComptoirSaleModel.aggregate<{ _id: { d: Id; day: string; m: string }; v: number; n: number }>([
      { $match: { tenantId: oid(tenantId), deskId: { $in: ids }, status: "paid", date: range } }, { $unwind: "$payments" },
      { $group: { _id: { d: "$deskId", day: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: "Africa/Niamey" } }, m: "$payments.method" }, v: { $sum: "$payments.amount" }, n: { $sum: 1 } } },
    ]),
    PurchaseModel.find({ tenantId, deskId: { $in: ids }, date: range, status: { $ne: "cancelled" } }).sort({ date: -1 }).select("deskId date number payee supplierRef totalTTC paidAmount status").limit(MAX_ROWS).lean<Array<{ deskId: Id; date: Date; number: string; payee?: string; supplierRef?: string; totalTTC: number; paidAmount?: number; status: string }>>(),
    PurchaseModel.aggregate<{ _id: Id; deskId: Id; number: string; payee?: string; pay: { date: Date; amount: number; movementId?: Id } }>([
      { $match: { tenantId: oid(tenantId), deskId: { $in: ids }, "payments.date": range } }, { $unwind: "$payments" }, { $match: { "payments.date": range, "payments.cancelledAt": { $exists: false } } },
      { $project: { deskId: 1, number: 1, payee: 1, pay: "$payments" } }, { $limit: MAX_ROWS },
    ]),
  ]);
  const site = (id: unknown) => desks.get(String(id)) ?? "—";
  const inTill = new Set(cash.map(c => String(c.movementId)));
  const rows: JournalRow[] = [
    ...sales.map(s => ({ date: `${s._id.day}T12:00:00`, deskId: String(s._id.d), site: site(s._id.d), kind: "sale" as const, label: `Ventes du jour (${s.n} ticket${s.n > 1 ? "s" : ""})`, category: "Ventes", method: s._id.m, party: null, piece: null, sale: s.v, receipt: NOT_CASHED.includes(s._id.m) ? 0 : s.v, expense: 0, status: NOT_CASHED.includes(s._id.m) ? "vendu, non encaissé en caisse" : null })),
    ...cash.map(c => {
      const internal = CASH_INTERNAL.includes(c.category ?? "");
      return { date: c.date.toISOString(), deskId: String(c.deskId), site: site(c.deskId), kind: internal ? "internal" as const : c.direction === "in" ? "in" as const : "out" as const, label: c.label, category: CATEGORY_LABELS[c.category ?? ""] ?? (c.direction === "in" ? "Encaissement" : "Autres dépenses"), method: c.method, party: null, piece: `CPT-${String(c._id).slice(-6).toUpperCase()}`, sale: 0, receipt: c.direction === "in" && !internal ? c.amount : 0, expense: c.direction === "out" && !internal ? c.amount : 0, status: null };
    }),
    // Règlement payé par un autre compte que la caisse du site : il ne passe pas par les entrées de caisse.
    ...paid.filter(p => !inTill.has(String(p.pay.movementId))).map(p => ({ date: new Date(p.pay.date).toISOString(), deskId: String(p.deskId), site: site(p.deskId), kind: "out" as const, label: `Règlement ${p.number}`, category: "Règlements fournisseurs", method: "compte", party: p.payee ?? null, piece: p.number, sale: 0, receipt: 0, expense: p.pay.amount, status: null })),
    ...invoices.map(p => ({ date: p.date.toISOString(), deskId: String(p.deskId), site: site(p.deskId), kind: "invoice" as const, label: `Facture ${p.number}${p.supplierRef ? ` (${p.supplierRef})` : ""}`, category: "Dette fournisseur", method: "—", party: p.payee ?? null, piece: p.number, sale: 0, receipt: 0, expense: 0, status: p.status === "paid" ? "soldée" : p.status === "partial" ? `reste ${(p.totalTTC - (p.paidAmount ?? 0)).toLocaleString("fr-FR")}` : `à payer ${p.totalTTC.toLocaleString("fr-FR")}` })),
  ].filter(r => (!f.category || r.category === f.category) && (!f.method || r.method === f.method)).sort((a, b) => b.date.localeCompare(a.date));
  return { rows, truncated: cash.length >= MAX_ROWS || invoices.length >= MAX_ROWS, totals: { sales: rows.reduce((t, r) => t + r.sale, 0), receipts: rows.reduce((t, r) => t + r.receipt, 0), expenses: rows.reduce((t, r) => t + r.expense, 0) }, categories: [...new Set(rows.map(r => r.category))].sort(), methods: [...new Set(rows.map(r => r.method))].sort() };
}

const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
const spanDays = (from: string, to: string) => Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000) + 1;

/** Comparaison de deux périodes de même durée, par site et au total : CA, tickets, sorties de caisse. */
export async function evolution(tenantId: string, deskIds: string[], from: string, to: string) {
  const n = spanDays(from, to), prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(n - 1));
  const desks = await ActivityDeskModel.find({ tenantId, _id: { $in: deskIds.map(oid) } }).select("name").sort({ name: 1 }).lean<Array<{ _id: Id; name: string }>>();
  const measure = async (deskId: Id, a: string, b: string) => {
    const [s, c] = await Promise.all([
      ComptoirSaleModel.aggregate<{ ttc: number; n: number }>([{ $match: { tenantId: oid(tenantId), deskId, status: "paid", date: bounds(a, b) } }, { $group: { _id: null, ttc: { $sum: "$totalTTC" }, n: { $sum: 1 } } }]),
      ActivityCashEntryModel.aggregate<{ v: number }>([{ $match: { tenantId: oid(tenantId), deskId, direction: "out", category: { $nin: CASH_INTERNAL }, date: bounds(a, b) } }, { $group: { _id: null, v: { $sum: "$amount" } } }]),
    ]);
    return { revenue: Math.round(s[0]?.ttc ?? 0), tickets: s[0]?.n ?? 0, expenses: Math.round(c[0]?.v ?? 0) };
  };
  const sites = await Promise.all(desks.map(async d => ({ deskId: String(d._id), name: d.name, current: await measure(d._id, from, to), previous: await measure(d._id, prevFrom, prevTo) })));
  const sum = (k: "current" | "previous") => sites.reduce((t, s) => ({ revenue: t.revenue + s[k].revenue, tickets: t.tickets + s[k].tickets, expenses: t.expenses + s[k].expenses }), { revenue: 0, tickets: 0, expenses: 0 });
  return { days: n, from, to, prevFrom, prevTo, sites, total: { current: sum("current"), previous: sum("previous") } };
}

/** À contrôler : tout ce qui attend une décision de la comptable, avec son nombre et sa valeur. */
export async function controls(tenantId: string, deskIds: string[], now = new Date()) {
  const ids = deskIds.map(oid), today = localDay(now);
  const since = new Date(now.getTime() - 35 * 86_400_000);
  const [gaps, transit, unvalued, noInvoice, noInvoiceCash, late, toQualify, cashGaps, missing, toValidate, shares, reopened] = await Promise.all([
    DeskTransferModel.find({ tenantId, status: "gap", $or: [{ fromDeskId: { $in: ids } }, { toDeskId: { $in: ids } }] }).select("number fromName toName").lean<Array<{ number: string; fromName: string; toName: string }>>(),
    DeskTransferModel.countDocuments({ tenantId, status: { $in: ["sent", "transit"] }, $or: [{ fromDeskId: { $in: ids } }, { toDeskId: { $in: ids } }] }),
    PurchasePriceLogModel.countDocuments({ tenantId, deskId: { $in: ids }, unitCost: 0, date: { $gte: since } }),
    PurchasePriceLogModel.countDocuments({ tenantId, deskId: { $in: ids }, source: "reception", paidFromCash: false, invoiceRef: { $exists: false } }),
    PurchasePriceLogModel.countDocuments({ tenantId, deskId: { $in: ids }, source: "reception", paidFromCash: true, invoiceRef: { $exists: false }, date: { $gte: since } }),
    PurchaseModel.find({ tenantId, deskId: { $in: ids }, status: { $in: ["validated", "partial"] }, dueDate: { $lt: now } }).select("totalTTC paidAmount").lean<Array<{ totalTTC: number; paidAmount?: number }>>(),
    DeskFundingModel.countDocuments({ tenantId, deskId: { $in: ids }, cancelledAt: { $exists: false }, $or: [{ kind: "money", validatedAt: { $exists: false } }, { kind: { $in: ["owner_paid", "debt"] }, qualifiedAt: { $exists: false } }] }),
    CashClosingModel.find({ tenantId, deskId: { $in: ids }, gap: { $ne: 0 }, day: { $gte: localDay(since) } }).select("gap").lean<Array<{ gap: number }>>(),
    Promise.all(ids.map(async id => {
      const [yesterday, had] = [localDay(new Date(now.getTime() - 86_400_000)), await ComptoirSaleModel.exists({ tenantId, deskId: id, status: "paid", date: bounds(localDay(new Date(now.getTime() - 86_400_000)), localDay(new Date(now.getTime() - 86_400_000))) })];
      return had && !(await CashClosingModel.exists({ tenantId, deskId: id, day: { $gte: yesterday } })) ? 1 : 0;
    })),
    ActivityDeskModel.find({ tenantId, _id: { $in: ids }, archived: { $ne: true }, strictStock: true, openingValidatedAt: { $exists: false } }).select("name vatRate").lean<Array<{ name: string; vatRate?: number }>>(),
    ActivityDeskModel.find({ tenantId, archived: { $ne: true } }).select("commonCostShare").lean<Array<{ commonCostShare?: number }>>(),
    DeskWeekCloseModel.countDocuments({ tenantId, deskId: { $in: ids }, status: "reopened" }),
  ]);
  const shareTotal = Math.round(shares.reduce((t, d) => t + (d.commonCostShare ?? 0), 0) * 1000) / 10;
  const items = [
    { key: "gaps", label: "Écarts de transfert à trancher", count: gaps.length, detail: gaps.map(g => `${g.number} : ${g.fromName} → ${g.toName}`).slice(0, 5).join(" · ") },
    { key: "transit", label: "Transferts encore en transit", count: transit },
    { key: "unvalued", label: "Réceptions sans prix (35 jours)", count: unvalued },
    { key: "noInvoice", label: "Réceptions à crédit sans facture du fournisseur", count: noInvoice },
    { key: "noInvoiceCash", label: "Achats payés en caisse sans facture (35 jours)", count: noInvoiceCash, detail: noInvoiceCash ? "Sans facture conforme, la charge et la TVA peuvent être refusées : voir le guide." : undefined },
    { key: "late", label: "Factures fournisseurs en retard", count: late.length, amount: late.reduce((t, p) => t + p.totalTTC - (p.paidAmount ?? 0), 0) },
    { key: "qualify", label: "Financements à qualifier", count: toQualify },
    { key: "cash", label: "Écarts de caisse (35 jours), en valeur absolue", count: cashGaps.length, amount: cashGaps.reduce((t, c) => t + Math.abs(c.gap), 0) },
    { key: "validate", label: "Sites à valider : situation de départ et taux de TVA", count: toValidate.length, detail: toValidate.map(d => `${d.name} (TVA ${Math.round((d.vatRate ?? 0) * 1000) / 10} %)`).slice(0, 5).join(" · ") },
    { key: "reopened", label: "Semaines rouvertes, à clôturer de nouveau", count: reopened },
    { key: "shares", label: "Quotes-parts des charges communes différentes de 100 %", count: shareTotal > 0 && Math.abs(shareTotal - 100) > 0.05 ? 1 : 0, detail: shareTotal > 0 ? `Total actuel : ${shareTotal} %. Ce qui n'est pas réparti n'apparaît sur aucun site.` : undefined },
    { key: "closing", label: "Sites sans arrêté de caisse d'hier", count: missing.reduce((t: number, x) => t + x, 0) },
  ];
  return { today, items, total: items.reduce((t, i) => t + i.count, 0) };
}

const monthsSince = (from: Date, now: Date) => {
  const out: string[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  while (d <= now) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); d.setMonth(d.getMonth() + 1); }
  return out;
};

/**
 * Équilibre d'un site, chaque chiffre pour ce qu'il mesure : résultat cumulé
 * depuis le lancement, CA d'équilibre du mois, trésorerie et échéances à venir,
 * avance à rembourser. Le seuil de rentabilité ne dit pas si la mise est
 * remboursée ; l'avance restante le dit. Un mois clos compte pour son résultat
 * figé ; les mois ouverts sont recalculés un par un, et leurs réserves sont
 * rendues : un cumul incomplet se dit.
 */
export async function siteBalance(tenantId: string, deskId: string, canPayroll: boolean, now = new Date()) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("name openingDate createdAt treasuryAccountId").lean<{ name: string; openingDate?: Date; createdAt: Date; treasuryAccountId?: Id } | null>();
  if (!desk) return null;
  const months = monthsSince(desk.openingDate ?? desk.createdAt, now);
  const closes = new Map((await DeskMonthCloseModel.find({ tenantId, deskId, status: "closed", month: { $in: months } }).select("month snapshot").lean<Array<{ month: string; snapshot: { result?: number; revenueHT?: number } }>>()).map(c => [c.month, c.snapshot]));
  let cumulativeResult = 0, cumulativeRevenue = 0, hidden = false;
  const warnings = new Set<string>();
  const current = months[months.length - 1];
  let last: ReturnType<typeof maskPayroll> | null = null;
  for (const m of months) {
    const snap = closes.get(m);
    // Le mois en cours se recalcule toujours ; un mois clos sans droit à la paie aussi, pour que le masque s'applique.
    if (snap && m !== current && canPayroll && snap.result !== undefined) { cumulativeResult += snap.result; cumulativeRevenue += snap.revenueHT ?? 0; continue; }
    const r = maskPayroll(await deskMonthResult(tenantId, deskId, m), canPayroll);
    cumulativeResult += r.pnl.result; cumulativeRevenue += r.pnl.revenueHT;
    if (r.payrollHidden) hidden = true;
    for (const w of r.warnings) if (/absents|sans coût|sans prix/.test(w)) warnings.add(`${m} : ${w}`);
    if (m === current) last = r;
  }
  const [bal, due, funding] = await Promise.all([
    desk.treasuryAccountId ? accountBalance(tenantId, String(desk.treasuryAccountId)) : Promise.resolve(null),
    PurchaseModel.find({ tenantId, deskId, status: { $in: ["validated", "partial"] }, dueDate: { $lte: new Date(now.getTime() + 7 * 86_400_000) } }).select("totalTTC paidAmount").lean<Array<{ totalTTC: number; paidAmount?: number }>>(),
    DeskFundingModel.find({ tenantId, deskId, repayable: true, cancelledAt: { $exists: false } }).select("amount repaid").lean<Array<{ amount: number; repaid?: number }>>(),
  ]);
  return {
    name: desk.name, since: months[0], cumulativeResult, cumulativeRevenue, payrollHidden: hidden, warnings: [...warnings].slice(0, 6),
    levels: last?.levels ?? null, breakEvenRevenue: last?.pnl.ratios.breakEvenRevenue ?? null, monthRevenue: last?.pnl.revenueHT ?? 0,
    cash: bal?.balance ?? null, dueIn7Days: due.reduce((t, p) => t + p.totalTTC - (p.paidAmount ?? 0), 0), repayableLeft: funding.reduce((t, f) => t + f.amount - (f.repaid ?? 0), 0),
  };
}

export interface MarginRow { itemId: string; name: string; category: string; kind: "direct" | "recipe"; sold: number; netHT: number; standardCost: number | null; expectedMargin: number | null; realCost: number; losses: number; gaps: number; actualMargin: number | null; estimated: boolean }

/**
 * Marge par article d'un mois : quantités, ventes nettes, coût standard,
 * marge attendue ; pertes et écarts attribuables. Un article revendu a une
 * marge constatée. Un plat aux ingrédients communs n'en a pas : sa marge reste
 * une estimation, le constaté se lit par famille et au total du site.
 */
export async function marginTable(tenantId: string, deskId: string, month: string) {
  const [y, m] = month.split("-").map(Number);
  const fromDay = `${month}-01`, toDay = localDay(new Date(y, m, 0, 12));
  const [sales, result, pricing, items] = await Promise.all([
    productSales(tenantId, deskId, fromDay, toDay), deskMonthResult(tenantId, deskId, month), deskPricing(tenantId, deskId),
    ActivityItemModel.find({ tenantId, deskId }).select("name recipe category").lean<Array<{ _id: Id; name: string; recipe?: unknown[]; category?: string }>>(),
  ]);
  const std = new Map(pricing.rows.map(r => [r.itemId, r.cost ?? null]));
  const byId = new Map(items.map(i => [String(i._id), i]));
  const lost = new Map<string, number>();
  for (const l of result.lossesByItem) lost.set(l.name, (lost.get(l.name) ?? 0) + l.value);
  const gapOf = new Map(result.consumption.map(c => [c.itemId, Math.round(c.inventoryGap * c.unitCost)]));
  const rows: MarginRow[] = sales.map(s => {
    const it = byId.get(s.itemId), recipe = !!it?.recipe?.length, unit = std.get(s.itemId) ?? null;
    const expected = unit === null || !unit ? null : Math.round(s.revenueHT - s.quantity * unit);
    const losses = recipe ? 0 : lost.get(s.label) ?? 0, gaps = recipe ? 0 : gapOf.get(s.itemId) ?? 0;
    return { itemId: s.itemId, name: s.label, category: s.category || "Sans famille", kind: recipe ? "recipe" as const : "direct" as const, sold: s.quantity, netHT: Math.round(s.revenueHT), standardCost: unit, expectedMargin: expected, realCost: Math.round(s.cost), losses, gaps, actualMargin: recipe || !s.valued ? null : Math.round(s.margin - losses + gaps), estimated: recipe };
  }).sort((a, b) => b.netHT - a.netHT);
  const families = [...new Set(rows.map(r => r.category))].map(c => {
    const xs = rows.filter(r => r.category === c);
    return { category: c, netHT: xs.reduce((t, r) => t + r.netHT, 0), expected: xs.reduce((t, r) => t + (r.expectedMargin ?? 0), 0), realCost: xs.reduce((t, r) => t + r.realCost, 0) };
  });
  return { month, rows, families, missingCost: rows.filter(r => r.expectedMargin === null).length, site: { expected: rows.reduce((t, r) => t + (r.expectedMargin ?? 0), 0), actual: result.pnl.materialMargin, revenueHT: result.pnl.revenueHT, losses: result.pnl.losses, gap: result.pnl.inventoryGap }, method: "Attendue = ventes nettes − quantité × coût standard de la fiche. Constatée = marge des tickets − pertes + écarts d'inventaire ; pour un plat, seule l'estimation est donnée, le constaté se lit au total du site." };
}
