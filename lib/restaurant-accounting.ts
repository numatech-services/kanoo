import { Types } from "mongoose";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { CashClosingModel } from "@/models/CashClosing";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { DeskFundingModel } from "@/models/DeskFunding";
import { DeskTransferModel } from "@/models/DeskTransfer";
import { PurchaseModel } from "@/models/Purchase";
import { PurchasePriceLogModel } from "@/models/PurchasePriceLog";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { accountBalance } from "@/lib/treasury";
import { productSales } from "@/lib/comptoir-session";
import { deskMonthResult } from "@/lib/restaurant-result";
import { deskPricing } from "@/lib/restaurant-overview";
import { localDay } from "@/lib/format";

type Id = Types.ObjectId;
const oid = (v: unknown) => new Types.ObjectId(String(v));
const INTERNAL = ["funding", "cash_transfer"];
const CATEGORY_LABELS: Record<string, string> = { ...EXPENSE_CATEGORIES, purchase: "Achats de marchandises", supplier_payment: "Règlements fournisseurs", funding: "Dotation du site", cash_transfer: "Remise / virement interne", non_sale: "Entrée hors vente", easypay_topup: "Recharge EasyPay" };
export const bounds = (from: string, to: string) => ({ $gte: new Date(`${from}T00:00:00`), $lte: new Date(`${to}T23:59:59.999`) });

export interface JournalRow { date: string; deskId: string; site: string; kind: "sale" | "in" | "out" | "internal" | "invoice"; label: string; category: string; method: string; party: string | null; piece: string | null; receipt: number; expense: number; status: string | null }

/**
 * Journal d'un périmètre : ventes du jour par moyen de paiement, entrées et
 * sorties de caisse, factures fournisseurs. Les mouvements internes (dotations,
 * remises en banque) y figurent à part : ils ne comptent ni en recette ni en
 * dépense, même consolidés.
 */
export async function journal(tenantId: string, deskIds: string[], from: string, to: string, f: { category?: string; method?: string } = {}) {
  const ids = deskIds.map(oid), range = bounds(from, to);
  const desks = new Map((await ActivityDeskModel.find({ tenantId, _id: { $in: ids } }).select("name").lean<Array<{ _id: Id; name: string }>>()).map(d => [String(d._id), d.name]));
  const [cash, sales, invoices] = await Promise.all([
    ActivityCashEntryModel.find({ tenantId, deskId: { $in: ids }, date: range, saleId: { $exists: false } }).sort({ date: -1 }).limit(2000).lean<Array<{ _id: Id; deskId: Id; date: Date; direction: string; amount: number; label: string; method: string; category?: string }>>(),
    ComptoirSaleModel.aggregate<{ _id: { d: Id; day: string; m: string }; v: number; n: number }>([
      { $match: { tenantId: oid(tenantId), deskId: { $in: ids }, status: "paid", date: range } }, { $unwind: "$payments" },
      { $group: { _id: { d: "$deskId", day: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: "Africa/Niamey" } }, m: "$payments.method" }, v: { $sum: "$payments.amount" }, n: { $sum: 1 } } },
    ]),
    PurchaseModel.find({ tenantId, deskId: { $in: ids }, date: range, status: { $ne: "cancelled" } }).select("deskId date number payee supplierRef totalTTC paidAmount status").limit(1000).lean<Array<{ deskId: Id; date: Date; number: string; payee?: string; supplierRef?: string; totalTTC: number; paidAmount?: number; status: string }>>(),
  ]);
  const site = (id: unknown) => desks.get(String(id)) ?? "—";
  const rows: JournalRow[] = [
    ...sales.map(s => ({ date: `${s._id.day}T12:00:00`, deskId: String(s._id.d), site: site(s._id.d), kind: "sale" as const, label: `Ventes du jour (${s.n} ticket${s.n > 1 ? "s" : ""})`, category: "Ventes", method: s._id.m, party: null, piece: null, receipt: s.v, expense: 0, status: null })),
    ...cash.map(c => {
      const internal = INTERNAL.includes(c.category ?? "");
      return { date: c.date.toISOString(), deskId: String(c.deskId), site: site(c.deskId), kind: internal ? "internal" as const : c.direction === "in" ? "in" as const : "out" as const, label: c.label, category: CATEGORY_LABELS[c.category ?? ""] ?? (c.direction === "in" ? "Encaissement" : "Autres dépenses"), method: c.method, party: null, piece: `CPT-${String(c._id).slice(-6).toUpperCase()}`, receipt: c.direction === "in" && !internal ? c.amount : 0, expense: c.direction === "out" && !internal ? c.amount : 0, status: null };
    }),
    ...invoices.map(p => ({ date: p.date.toISOString(), deskId: String(p.deskId), site: site(p.deskId), kind: "invoice" as const, label: `Facture ${p.number}${p.supplierRef ? ` (${p.supplierRef})` : ""}`, category: "Dette fournisseur", method: "—", party: p.payee ?? null, piece: p.number, receipt: 0, expense: 0, status: p.status === "paid" ? "soldée" : p.status === "partial" ? `reste ${(p.totalTTC - (p.paidAmount ?? 0)).toLocaleString("fr-FR")}` : `à payer ${p.totalTTC.toLocaleString("fr-FR")}` })),
  ].filter(r => (!f.category || r.category === f.category) && (!f.method || r.method === f.method)).sort((a, b) => b.date.localeCompare(a.date));
  // Une vente à crédit ou par carte n'est pas un encaissement en caisse : elle reste une recette d'activité, signalée par son moyen.
  return { rows, totals: { receipts: rows.reduce((t, r) => t + r.receipt, 0), expenses: rows.reduce((t, r) => t + r.expense, 0) }, categories: [...new Set(rows.map(r => r.category))].sort(), methods: [...new Set(rows.map(r => r.method))].sort() };
}

const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
const spanDays = (from: string, to: string) => Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000) + 1;

/** Comparaison de deux périodes de même durée, par site et au total : CA, tickets, recettes, dépenses. */
export async function evolution(tenantId: string, deskIds: string[], from: string, to: string) {
  const n = spanDays(from, to), prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(n - 1));
  const desks = await ActivityDeskModel.find({ tenantId, _id: { $in: deskIds.map(oid) } }).select("name").sort({ name: 1 }).lean<Array<{ _id: Id; name: string }>>();
  const measure = async (deskId: Id, a: string, b: string) => {
    const [s, c] = await Promise.all([
      ComptoirSaleModel.aggregate<{ ttc: number; n: number }>([{ $match: { tenantId: oid(tenantId), deskId, status: "paid", date: bounds(a, b) } }, { $group: { _id: null, ttc: { $sum: "$totalTTC" }, n: { $sum: 1 } } }]),
      ActivityCashEntryModel.aggregate<{ v: number }>([{ $match: { tenantId: oid(tenantId), deskId, direction: "out", category: { $nin: INTERNAL }, date: bounds(a, b) } }, { $group: { _id: null, v: { $sum: "$amount" } } }]),
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
  const [gaps, transit, unvalued, noInvoice, late, toQualify, cashGaps, missing] = await Promise.all([
    DeskTransferModel.find({ tenantId, status: "gap", $or: [{ fromDeskId: { $in: ids } }, { toDeskId: { $in: ids } }] }).select("number fromName toName").lean<Array<{ number: string; fromName: string; toName: string }>>(),
    DeskTransferModel.countDocuments({ tenantId, status: "transit", $or: [{ fromDeskId: { $in: ids } }, { toDeskId: { $in: ids } }] }),
    PurchasePriceLogModel.countDocuments({ tenantId, deskId: { $in: ids }, unitCost: 0, date: { $gte: since } }),
    PurchasePriceLogModel.countDocuments({ tenantId, deskId: { $in: ids }, source: "reception", paidFromCash: false, invoiceRef: { $exists: false } }),
    PurchaseModel.find({ tenantId, deskId: { $in: ids }, status: { $in: ["validated", "partial"] }, dueDate: { $lt: now } }).select("totalTTC paidAmount").lean<Array<{ totalTTC: number; paidAmount?: number }>>(),
    DeskFundingModel.countDocuments({ tenantId, deskId: { $in: ids }, kind: "money", validatedAt: { $exists: false }, cancelledAt: { $exists: false } }),
    CashClosingModel.find({ tenantId, deskId: { $in: ids }, gap: { $ne: 0 }, day: { $gte: localDay(since) } }).select("gap").lean<Array<{ gap: number }>>(),
    Promise.all(ids.map(async id => {
      const [yesterday, had] = [localDay(new Date(now.getTime() - 86_400_000)), await ComptoirSaleModel.exists({ tenantId, deskId: id, status: "paid", date: bounds(localDay(new Date(now.getTime() - 86_400_000)), localDay(new Date(now.getTime() - 86_400_000))) })];
      return had && !(await CashClosingModel.exists({ tenantId, deskId: id, day: { $gte: yesterday } })) ? 1 : 0;
    })),
  ]);
  const items = [
    { key: "gaps", label: "Écarts de transfert à trancher", count: gaps.length, detail: gaps.map(g => `${g.number} : ${g.fromName} → ${g.toName}`).slice(0, 5).join(" · ") },
    { key: "transit", label: "Transferts encore en transit", count: transit },
    { key: "unvalued", label: "Réceptions sans prix (35 jours)", count: unvalued },
    { key: "noInvoice", label: "Réceptions sans facture du fournisseur", count: noInvoice },
    { key: "late", label: "Factures fournisseurs en retard", count: late.length, amount: late.reduce((t, p) => t + p.totalTTC - (p.paidAmount ?? 0), 0) },
    { key: "qualify", label: "Financements à qualifier", count: toQualify },
    { key: "cash", label: "Écarts de caisse (35 jours)", count: cashGaps.length, amount: cashGaps.reduce((t, c) => t + c.gap, 0) },
    { key: "closing", label: "Sites sans arrêté de caisse d'hier", count: missing.reduce((t: number, x) => t + x, 0) },
  ];
  return { today, items, total: items.reduce((t, i) => t + i.count, 0) };
}

const monthsSince = (from: Date, now: Date) => {
  const out: string[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  while (d <= now && out.length < 36) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); d.setMonth(d.getMonth() + 1); }
  return out;
};

/**
 * Équilibre d'un site, chaque chiffre pour ce qu'il mesure : résultat cumulé
 * depuis le lancement, CA d'équilibre du mois, trésorerie et échéances à venir,
 * avance à rembourser. Le seuil de rentabilité ne dit pas si la mise est
 * remboursée ; l'avance restante le dit.
 */
export async function siteBalance(tenantId: string, deskId: string, now = new Date()) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("name openingDate createdAt treasuryAccountId").lean<{ name: string; openingDate?: Date; createdAt: Date; treasuryAccountId?: Id } | null>();
  if (!desk) return null;
  const months = monthsSince(desk.openingDate ?? desk.createdAt, now);
  const results = await Promise.all(months.map(m => deskMonthResult(tenantId, deskId, m)));
  const last = results[results.length - 1];
  const [bal, due, funding] = await Promise.all([
    desk.treasuryAccountId ? accountBalance(tenantId, String(desk.treasuryAccountId)) : Promise.resolve(null),
    PurchaseModel.find({ tenantId, deskId, status: { $in: ["validated", "partial"] }, dueDate: { $lte: new Date(now.getTime() + 7 * 86_400_000) } }).select("totalTTC paidAmount").lean<Array<{ totalTTC: number; paidAmount?: number }>>(),
    DeskFundingModel.find({ tenantId, deskId, repayable: true, cancelledAt: { $exists: false } }).select("amount repaid").lean<Array<{ amount: number; repaid?: number }>>(),
  ]);
  return {
    name: desk.name, since: months[0], cumulativeResult: results.reduce((t, r) => t + r.pnl.result, 0), cumulativeRevenue: results.reduce((t, r) => t + r.pnl.revenueHT, 0),
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
    const expected = unit === null ? null : Math.round(s.revenueHT - s.quantity * unit);
    const losses = recipe ? 0 : lost.get(s.label) ?? 0, gaps = recipe ? 0 : gapOf.get(s.itemId) ?? 0;
    return { itemId: s.itemId, name: s.label, category: s.category || "Sans famille", kind: recipe ? "recipe" as const : "direct" as const, sold: s.quantity, netHT: Math.round(s.revenueHT), standardCost: unit, expectedMargin: expected, realCost: Math.round(s.cost), losses, gaps, actualMargin: recipe || !s.valued ? null : Math.round(s.margin - losses + gaps), estimated: recipe };
  }).sort((a, b) => b.netHT - a.netHT);
  const families = [...new Set(rows.map(r => r.category))].map(c => {
    const xs = rows.filter(r => r.category === c);
    return { category: c, netHT: xs.reduce((t, r) => t + r.netHT, 0), expected: xs.reduce((t, r) => t + (r.expectedMargin ?? 0), 0), realCost: xs.reduce((t, r) => t + r.realCost, 0) };
  });
  return { month, rows, families, site: { expected: rows.reduce((t, r) => t + (r.expectedMargin ?? 0), 0), actual: result.pnl.materialMargin, revenueHT: result.pnl.revenueHT, losses: result.pnl.losses, gap: result.pnl.inventoryGap }, method: "Attendue = ventes nettes − quantité × coût standard de la fiche. Constatée = marge des tickets − pertes + écarts d'inventaire ; pour un plat, seule l'estimation est donnée, le constaté se lit au total du site." };
}
