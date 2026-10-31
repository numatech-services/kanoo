import { Types } from "mongoose";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { PayslipModel } from "@/models/Payslip";
import { EmployeeModel } from "@/models/Employee";
import { ItemCountModel } from "@/models/ItemCount";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { DeskMonthCloseModel } from "@/models/DeskMonthClose";
import { ProductStockModel } from "@/models/ProductStock";
import { ProductModel } from "@/models/Product";
import { StockMovementModel } from "@/models/StockMovement";
import { lossesReport } from "@/lib/spot-server";
import { EXPENSE_ACCOUNTS } from "@/lib/expense-categories";
import { computePnl, chargeCategory, isGoodsPurchase, monthBounds, staffCost, CHARGE_CATEGORIES, type ChargeCategory, type Pnl } from "@/lib/restaurant";

type Id = Types.ObjectId;
const oid = (v: unknown) => new Types.ObjectId(String(v));
const STAFF_LOSSES = ["staff", "offered"];

interface DeskLean { _id: Id; name: string; activityId?: Id; warehouseId?: Id; reserveWarehouseId?: Id; staff?: Array<{ employeeId: Id; share: number }>; plannedCosts?: Array<{ category: string; label?: string; amount: number }>; openDaysPerMonth?: number; commonCostShare?: number }

export interface ConsumptionRow { itemId: string; name: string; unit: string; sold: number; losses: number; inventoryGap: number; real: number; unitCost: number; varianceValue: number; variancePct: number | null }

export interface MonthResult {
  month: string; desk: { _id: string; name: string; hasSector: boolean; sharedWith: string[]; commonShare: number };
  pnl: Pnl;
  sales: { tickets: number; revenueTTC: number; cancelled: number; unvaluedLines: number; vatByRate: Array<{ rate: number; ht: number; tva: number }>; byMethod: Array<{ method: string; amount: number }> };
  lossesByReason: Array<{ reason: string; label: string; value: number }>;
  lossesByItem: Array<{ name: string; reason: string; quantity: number; value: number }>;
  inventories: Array<{ number: string; level: string; gapValue: number; validatedAt: Date }>;
  chargesDetail: Array<{ category: ChargeCategory; accountCode: string; accountLabel: string; amount: number; common?: boolean }>;
  /** Détail nominatif du personnel : seulement pour qui a le droit de lire la paie. */
  staffDetail: Array<{ employeeId: string; name: string; share: number; allocated: number }>;
  staffTotal: number;
  consumption: ConsumptionRow[];
  reconciliation: { accountingRevenue: number; accountingPurchases: number; stockEntriesValued: number; unvaluedReceptions: number; untaggedCharges: number };
  warnings: string[];
  closed: { closedAt: Date; result: number; drift: number; snapshot: Record<string, unknown> } | null;
}

/** Ventes du mois : CA HT, coût des lignes au coût connu, lignes sans coût, TVA par taux, encaissements par moyen. */
async function salesOf(tenantId: string, deskId: string, from: Date, to: Date) {
  const match = { tenantId: oid(tenantId), deskId: oid(deskId), status: "paid", date: { $gte: from, $lte: to } };
  const noCost = { $eq: [{ $ifNull: ["$lines.marginHT", null] }, null] };
  const [t, l, vat, pay, cancelled] = await Promise.all([
    ComptoirSaleModel.aggregate<{ tickets: number; ttc: number }>([{ $match: match }, { $group: { _id: null, tickets: { $sum: 1 }, ttc: { $sum: "$totalTTC" } } }]),
    ComptoirSaleModel.aggregate<{ ht: number; cost: number; unvaluedHT: number; unvaluedLines: number }>([{ $match: match }, { $unwind: "$lines" }, { $group: { _id: null, ht: { $sum: "$lines.totalHT" },
      cost: { $sum: { $cond: [noCost, 0, "$lines.costTotal"] } }, unvaluedHT: { $sum: { $cond: [noCost, "$lines.totalHT", 0] } }, unvaluedLines: { $sum: { $cond: [noCost, 1, 0] } } } }]),
    ComptoirSaleModel.aggregate<{ _id: number; ht: number; tva: number }>([{ $match: match }, { $unwind: "$lines" }, { $group: { _id: "$lines.tvaRate", ht: { $sum: "$lines.totalHT" }, tva: { $sum: "$lines.totalTVA" } } }, { $sort: { _id: 1 } }]),
    ComptoirSaleModel.aggregate<{ _id: string; amount: number }>([{ $match: match }, { $unwind: "$payments" }, { $group: { _id: "$payments.method", amount: { $sum: "$payments.amount" } } }]),
    ComptoirSaleModel.countDocuments({ tenantId, deskId, status: "cancelled", date: { $gte: from, $lte: to } }),
  ]);
  return {
    tickets: t[0]?.tickets ?? 0, ttc: t[0]?.ttc ?? 0, ht: l[0]?.ht ?? 0, cost: l[0]?.cost ?? 0, unvaluedHT: l[0]?.unvaluedHT ?? 0, unvaluedLines: l[0]?.unvaluedLines ?? 0, cancelled,
    vatByRate: vat.map(v => ({ rate: v._id ?? 0, ht: Math.round(v.ht), tva: Math.round(v.tva) })), byMethod: pay.map(p => ({ method: p._id, amount: Math.round(p.amount) })),
  };
}

/** Lignes de classe 6 du mois, par compte : imputées au secteur (`activityId`) ou communes (sans secteur). */
async function class6(tenantId: string, from: Date, to: Date, activityId: Id | null) {
  const lineMatch = activityId ? { "lines.activityId": activityId } : { "lines.activityId": { $exists: false } };
  const rows = await AccountingEntryModel.aggregate<{ _id: { code: string; cash: boolean }; label: string; amount: number }>([
    { $match: { tenantId: oid(tenantId), entryDate: { $gte: from, $lte: to }, ...(activityId ? { "lines.activityId": activityId } : {}), "lines.accountCode": { $regex: "^6" } } },
    { $unwind: "$lines" },
    { $match: { ...lineMatch, "lines.accountCode": { $regex: "^6" } } },
    { $group: { _id: { code: "$lines.accountCode", cash: { $eq: ["$linkedDocType", "desk_cash"] } }, label: { $last: "$lines.accountLabel" }, amount: { $sum: { $subtract: [{ $ifNull: ["$lines.debit", 0] }, { $ifNull: ["$lines.credit", 0] }] } } } },
  ]);
  // `cash` : dépense de caisse du comptoir (primes, repas du personnel…), jamais un bulletin de paie.
  return rows.map(r => ({ _id: r._id.code, cash: r._id.cash, label: r.label, amount: r.amount }));
}

/** Classe 7 du secteur : chiffre d'affaires comptable, pour le rapprochement. */
async function revenueOf(tenantId: string, from: Date, to: Date, activityId: Id) {
  const [r] = await AccountingEntryModel.aggregate<{ v: number }>([
    { $match: { tenantId: oid(tenantId), entryDate: { $gte: from, $lte: to }, "lines.activityId": activityId } }, { $unwind: "$lines" },
    { $match: { "lines.activityId": activityId, "lines.accountCode": { $regex: "^70" } } },
    { $group: { _id: null, v: { $sum: { $subtract: [{ $ifNull: ["$lines.credit", 0] }, { $ifNull: ["$lines.debit", 0] }] } } } },
  ]);
  return Math.round(r?.v ?? 0);
}

/** Personnel affecté : coût employeur des bulletins du mois × part de temps au comptoir. */
async function staffOf(tenantId: string, desk: DeskLean, year: number, m: number) {
  const staff = (desk.staff ?? []).map(s => ({ employeeId: String(s.employeeId), share: s.share }));
  if (!staff.length) return { rows: [], missing: [] as string[] };
  const [slips, emps] = await Promise.all([
    PayslipModel.find({ tenantId, year, month: m, employeeId: { $in: staff.map(s => s.employeeId) } }).select("employeeId employerCost grossTotal cnssEmployer").lean<Array<{ employeeId: Id; employerCost?: number; grossTotal?: number; cnssEmployer?: number }>>(),
    EmployeeModel.find({ tenantId, _id: { $in: staff.map(s => s.employeeId) } }).select("firstName lastName").lean<Array<{ _id: Id; firstName?: string; lastName?: string }>>(),
  ]);
  const name = (id: string) => { const e = emps.find(x => String(x._id) === id); return e ? `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() : "—"; };
  const rows = staff.map(s => {
    const own = slips.filter(p => String(p.employeeId) === s.employeeId).map(p => ({ ...p, employeeId: String(p.employeeId) }));
    return { employeeId: s.employeeId, name: name(s.employeeId), share: s.share, allocated: staffCost(own, [{ employeeId: s.employeeId, share: s.share }]), hasSlip: own.length > 0 };
  });
  return { rows, missing: rows.filter(r => !r.hasSlip).map(r => r.name) };
}

/**
 * Consommation théorique (ventes, ingrédients des recettes compris) comparée
 * à la consommation réelle (théorique + pertes déclarées + manquants
 * d'inventaire), article par article, au coût. C'est l'écart à expliquer.
 */
async function consumptionOf(tenantId: string, deskId: string, from: Date, to: Date, fromDay: string, toDay: string, losses: Array<{ itemId: string; quantity: number }>, reserveGaps: Map<string, number>): Promise<ConsumptionRow[]> {
  const match = { tenantId: oid(tenantId), deskId: oid(deskId), status: "paid", date: { $gte: from, $lte: to } };
  const [direct, ings, counts, items] = await Promise.all([
    ComptoirSaleModel.aggregate<{ _id: Id; q: number }>([{ $match: match }, { $unwind: "$lines" }, { $match: { $or: [{ "lines.ingredients": { $exists: false } }, { "lines.ingredients": { $size: 0 } }] } }, { $group: { _id: "$lines.itemId", q: { $sum: "$lines.quantity" } } }]),
    ComptoirSaleModel.aggregate<{ _id: Id; q: number }>([{ $match: match }, { $unwind: "$lines" }, { $unwind: "$lines.ingredients" }, { $group: { _id: "$lines.ingredients.itemId", q: { $sum: "$lines.ingredients.quantity" } } }]),
    ItemCountModel.aggregate<{ _id: Id; g: number }>([{ $match: { tenantId: oid(tenantId), deskId: oid(deskId), day: { $gte: fromDay, $lte: toDay } } }, { $group: { _id: "$itemId", g: { $sum: "$gap" } } }]),
    ActivityItemModel.find({ tenantId, deskId }).select("name unit unitCost recipe").lean<Array<{ _id: Id; name: string; unit: string; unitCost?: number; recipe?: unknown[] }>>(),
  ]);
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const sold = new Map<string, number>(), lost = new Map<string, number>(), gap = new Map<string, number>(reserveGaps);
  for (const d of [...direct, ...ings]) add(sold, String(d._id), d.q);
  for (const l of losses) add(lost, l.itemId, l.quantity);
  for (const c of counts) add(gap, String(c._id), c.g);
  return items.filter(i => !i.recipe?.length && (sold.has(String(i._id)) || lost.has(String(i._id)) || gap.has(String(i._id)))).map(i => {
    const k = String(i._id), s = sold.get(k) ?? 0, lo = lost.get(k) ?? 0, g = gap.get(k) ?? 0;
    const real = s + lo - g, cost = i.unitCost ?? 0, variance = real - s;
    return { itemId: k, name: i.name, unit: i.unit, sold: Math.round(s * 1000) / 1000, losses: Math.round(lo * 1000) / 1000, inventoryGap: Math.round(g * 1000) / 1000, real: Math.round(real * 1000) / 1000, unitCost: cost, varianceValue: Math.round(variance * cost), variancePct: s > 0 ? Math.round((variance / s) * 1000) / 10 : null };
  }).sort((a, b) => b.varianceValue - a.varianceValue);
}

/** Résultat de gestion d'un comptoir pour un mois « AAAA-MM ». */
export async function deskMonthResult(tenantId: string, deskId: string, month: string): Promise<MonthResult> {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("name activityId warehouseId reserveWarehouseId treasuryAccountId vatRate staff plannedCosts openDaysPerMonth commonCostShare").lean<DeskLean & { treasuryAccountId?: Id; vatRate?: number } | null>();
  if (!desk) throw new Error("Comptoir introuvable");
  const b = monthBounds(month);
  const warnings: string[] = [];
  const sharing = desk.activityId ? await ActivityDeskModel.find({ tenantId, activityId: desk.activityId, archived: { $ne: true }, _id: { $ne: desk._id } }).select("name").lean<Array<{ name: string }>>() : [];
  const whs = [desk.warehouseId, desk.reserveWarehouseId].filter(Boolean) as Id[];
  const [sales, losses, counts, invs, tagged, common, staff, closed, cash, revenueAcc, entries] = await Promise.all([
    salesOf(tenantId, deskId, b.from, b.to),
    lossesReport(tenantId, deskId, b.fromDay, b.toDay),
    ItemCountModel.aggregate<{ v: number }>([{ $match: { tenantId: oid(tenantId), deskId: oid(deskId), day: { $gte: b.fromDay, $lte: b.toDay } } }, { $group: { _id: null, v: { $sum: "$gapValue" } } }]),
    DeskInventoryModel.find({ tenantId, deskId, status: "validated", validatedAt: { $gte: b.from, $lte: b.to } }).select("number level opening gapValue validatedAt lines.itemId lines.gap").lean<Array<{ number: string; level: string; opening?: boolean; gapValue?: number; validatedAt: Date; lines: Array<{ itemId: Id; gap?: number }> }>>(),
    desk.activityId ? class6(tenantId, b.from, b.to, desk.activityId) : Promise.resolve([]),
    desk.commonCostShare ? class6(tenantId, b.from, b.to, null) : Promise.resolve([]),
    staffOf(tenantId, desk, b.year, b.m),
    DeskMonthCloseModel.findOne({ tenantId, deskId, month, status: "closed" }).select("closedAt snapshot").lean<{ closedAt: Date; snapshot: Record<string, unknown> & { result?: number } } | null>(),
    ActivityCashEntryModel.aggregate<{ v: number }>([{ $match: { tenantId: oid(tenantId), deskId: oid(deskId), direction: "out", category: { $in: ["supply", "ingredients"] }, date: { $gte: b.from, $lte: b.to } } }, { $group: { _id: null, v: { $sum: "$amount" } } }]),
    desk.activityId ? revenueOf(tenantId, b.from, b.to, desk.activityId) : Promise.resolve(0),
    whs.length ? StockMovementModel.aggregate<{ _id: boolean; v: number; n: number }>([
      { $match: { tenantId: oid(tenantId), warehouseId: { $in: whs }, type: "entry", createdAt: { $gte: b.from, $lte: b.to } } },
      // Entrée « à valoriser » (réception sans prix) : repérée par son motif, même si le CMUP précédent lui a été appliqué.
      { $group: { _id: { $and: [{ $gt: [{ $ifNull: ["$unitCost", 0] }, 0] }, { $not: [{ $regexMatch: { input: "$reason", regex: "à valoriser" } }] }] }, v: { $sum: { $multiply: ["$quantity", { $ifNull: ["$unitCost", 0] }] } }, n: { $sum: 1 } } },
    ]) : Promise.resolve([]),
  ]);

  // Charges imputées au secteur. Secteur partagé par plusieurs comptoirs : réparties à parts égales (avertissement).
  const split = 1 + sharing.length;
  if (sharing.length) warnings.push(`Secteur analytique partagé avec ${sharing.map(s => s.name).join(", ")} : ses charges sont réparties à parts égales (1/${split}). Donnez un secteur propre à chaque comptoir pour un résultat exact.`);
  const hasStaff = (desk.staff ?? []).length > 0;
  const chargesDetail: MonthResult["chargesDetail"] = [];
  let purchases = 0;
  for (const c of tagged) {
    if (isGoodsPurchase(c._id)) { purchases += c.amount; continue; }
    const cat = chargeCategory(c._id);
    // Personnel réparti par les bulletins : les 66 de la paie imputés au secteur ne s'y ajoutent pas ;
    // les primes et repas payés en caisse du comptoir, eux, restent.
    if (!cat || (cat === "personnel" && hasStaff && !c.cash)) continue;
    const amount = Math.round(c.amount / split);
    if (amount) chargesDetail.push({ category: cat, accountCode: c._id, accountLabel: c.label, amount });
  }
  // Quote-part des charges communes (sans secteur), hors achats de marchandises et hors paie (répartie par les bulletins).
  const share = desk.commonCostShare ?? 0;
  let untagged = 0;
  for (const c of common) {
    const cat = chargeCategory(c._id);
    if (!cat || cat === "personnel") continue;
    untagged += c.amount;
    const amount = Math.round(c.amount * share);
    if (amount) chargesDetail.push({ category: cat, accountCode: c._id, accountLabel: `${c.label} (quote-part ${Math.round(share * 100)} %)`, amount, common: true });
  }
  // Dépenses de caisse sans écriture (comptoir sans caisse de trésorerie liée) : reprises par leur nature.
  const unposted = await ActivityCashEntryModel.aggregate<{ _id: string; v: number }>([
    { $match: { tenantId: oid(tenantId), deskId: oid(deskId), direction: "out", entryId: { $exists: false }, category: { $nin: ["supply", "ingredients", "purchase"] }, date: { $gte: b.from, $lte: b.to } } },
    { $group: { _id: "$category", v: { $sum: "$amount" } } },
  ]);
  for (const u of unposted) {
    const acc = EXPENSE_ACCOUNTS[u._id] ?? EXPENSE_ACCOUNTS.other!;
    const cat = acc ? chargeCategory(acc.accountCode) : null;
    if (cat && u.v) chargesDetail.push({ category: cat, accountCode: acc!.accountCode, accountLabel: `${acc!.accountLabel} (caisse, sans écriture)`, amount: Math.round(u.v) });
  }
  if (!desk.treasuryAccountId) warnings.push("Comptoir sans caisse de trésorerie liée : ses encaissements et dépenses ne passent pas en comptabilité ; le résultat les reprend depuis la caisse du comptoir.");
  chargesDetail.sort((a, b2) => a.accountCode.localeCompare(b2.accountCode));
  const byCat: Partial<Record<ChargeCategory, number>> = {};
  for (const c of chargesDetail) byCat[c.category] = (byCat[c.category] ?? 0) + c.amount;
  const staffTotal = staff.rows.reduce((t, s) => t + s.allocated, 0);
  if (staffTotal) byCat.personnel = (byCat.personnel ?? 0) + staffTotal;
  if (staff.missing.length) warnings.push(`Bulletins du mois absents pour ${staff.missing.length} employé(s) affecté(s) : leur coût n'est pas encore compté.`);
  const planned: Partial<Record<ChargeCategory, number>> = {};
  for (const p of desk.plannedCosts ?? []) if (p.category in CHARGE_CATEGORIES) planned[p.category as ChargeCategory] = (planned[p.category as ChargeCategory] ?? 0) + p.amount;

  // Les manquants d'inventaire sont aussi des « pertes » (motif inventory) : comptés une fois, en écart d'inventaire.
  const declared = losses.byReason.filter(r => r.reason !== "inventory");
  const staffMeals = declared.filter(r => STAFF_LOSSES.includes(r.reason)).reduce((t, r) => t + r.value, 0);
  const otherLosses = declared.filter(r => !STAFF_LOSSES.includes(r.reason)).reduce((t, r) => t + r.value, 0);
  // Inventaire de stock initial (première saisie) : il constitue le stock, ce n'est pas un gain du mois.
  const reserveInv = invs.filter(i => i.level === "reserve" && !i.opening);
  const openingGap = invs.filter(i => i.opening).reduce((t, i) => t + (i.gapValue ?? 0), 0);
  const reserveGap = reserveInv.reduce((t, i) => t + (i.gapValue ?? 0), 0);
  const cashPurchases = cash[0]?.v ?? 0;
  // Ventes hors ticket (entrée de caisse « vente », sans ticket ni client à crédit) : au chiffre d'affaires, hors marge (coût inconnu).
  const [offTicket] = await ActivityCashEntryModel.aggregate<{ v: number }>([
    { $match: { tenantId: oid(tenantId), deskId: oid(deskId), direction: "in", saleId: { $exists: false }, customerId: { $exists: false }, category: { $ne: "non_sale" }, date: { $gte: b.from, $lte: b.to } } },
    { $group: { _id: null, v: { $sum: "$amount" } } },
  ]);
  const offTicketHT = Math.round((offTicket?.v ?? 0) / (1 + (desk.vatRate ?? 0)));
  if (offTicketHT) warnings.push(`${offTicketHT.toLocaleString("fr-FR")} FCFA HT de ventes hors ticket (entrées de caisse) : au chiffre d'affaires, hors marge. Passez les ventes par un ticket pour suivre leur marge.`);
  const thisMonth = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const pnl = computePnl({
    revenueHT: sales.ht + offTicketHT, costOfSales: sales.cost, unvaluedRevenueHT: sales.unvaluedHT + offTicketHT, tickets: sales.tickets, cashPurchases,
    losses: otherLosses, staffAndOffered: staffMeals, inventoryGap: (counts[0]?.v ?? 0) - invs.filter(i => i.opening && i.level === "desk").reduce((t, i) => t + (i.gapValue ?? 0), 0) + reserveGap,
    charges: byCat, planned, openDays: desk.openDaysPerMonth ?? 26, pastMonth: month < thisMonth,
  });
  if (openingGap) warnings.push(`Stock initial saisi ce mois-ci par inventaire (${Math.round(openingGap).toLocaleString("fr-FR")} FCFA au coût) : hors résultat.`);
  if (sales.unvaluedHT > 0) warnings.push(`${sales.unvaluedLines} ligne(s) vendue(s) sans coût connu : leur chiffre d'affaires est hors marge tant que le coût n'est pas renseigné.`);
  if (!desk.activityId) warnings.push("Comptoir sans secteur analytique : les charges comptables (eau, électricité, loyer…) ne sont pas reprises.");
  const unvaluedReceptions = entries.find(e => e._id === false)?.n ?? 0;
  if (unvaluedReceptions) warnings.push(`${unvaluedReceptions} entrée(s) en stock du mois sans prix d'achat : à valoriser (le coût des ventes est sous-estimé).`);
  if (cashPurchases) warnings.push("Des achats de marchandises ont été payés en caisse sans réception en réserve : ils sont comptés comme consommés dans le mois.");

  // Consommation par article (pertes par article déjà calculées ; manquants de réserve par article).
  const reserveGaps = new Map<string, number>();
  for (const i of reserveInv) for (const l of i.lines) if (l.gap) reserveGaps.set(String(l.itemId), (reserveGaps.get(String(l.itemId)) ?? 0) + l.gap);
  const itemNames = new Map((await ActivityItemModel.find({ tenantId, deskId }).select("name").lean<Array<{ _id: Id; name: string }>>()).map(i => [String(i._id), i.name]));
  const lossItems = losses.detail.filter(l => l.reason !== "inventory");
  const consumption = await consumptionOf(tenantId, deskId, b.from, b.to, b.fromDay, b.toDay, lossItems.map(l => ({ itemId: l.itemId, quantity: l.quantity })), reserveGaps);

  return {
    month, desk: { _id: String(desk._id), name: desk.name, hasSector: !!desk.activityId, sharedWith: sharing.map(s => s.name), commonShare: share }, pnl,
    sales: { tickets: sales.tickets, revenueTTC: Math.round(sales.ttc), cancelled: sales.cancelled, unvaluedLines: sales.unvaluedLines, vatByRate: sales.vatByRate, byMethod: sales.byMethod },
    lossesByReason: losses.byReason,
    lossesByItem: lossItems.map(l => ({ name: l.label || (itemNames.get(l.itemId) ?? "—"), reason: l.reason, quantity: l.quantity, value: l.value })),
    inventories: invs.map(i => ({ number: i.number, level: i.level, gapValue: i.gapValue ?? 0, validatedAt: i.validatedAt })),
    chargesDetail, staffDetail: staff.rows.map(({ hasSlip: _h, ...r }) => r), staffTotal, consumption,
    reconciliation: { accountingRevenue: Math.round(revenueAcc / split), accountingPurchases: Math.round(purchases / split), stockEntriesValued: Math.round(entries.find(e => e._id === true)?.v ?? 0), unvaluedReceptions, untaggedCharges: Math.round(untagged) },
    warnings,
    closed: closed ? { closedAt: closed.closedAt, result: closed.snapshot.result ?? 0, drift: pnl.result - (closed.snapshot.result ?? 0), snapshot: closed.snapshot } : null,
  };
}

/**
 * Stock des deux niveaux à une date (fin de mois) : quantité d'aujourd'hui
 * moins les mouvements postérieurs, valorisée au CMUP de la date (dernier
 * mouvement avant elle) ; articles hors catalogue : dernier mouvement du comptoir.
 */
export async function deskStockAt(tenantId: string, deskId: string, at: Date) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("warehouseId reserveWarehouseId").lean<DeskLean | null>();
  const items = await ActivityItemModel.find({ tenantId, deskId, $or: [{ recipe: { $exists: false } }, { recipe: { $size: 0 } }] }).select("name unit category productId unitCost").lean<Array<{ _id: Id; name: string; unit: string; category?: string; productId?: Id; unitCost?: number }>>();
  const rows: Array<{ name: string; category?: string; unit: string; reserve: number; desk: number; unitCost: number; value: number }> = [];
  for (const it of items) {
    let deskQty = 0, reserveQty = 0, cost = it.unitCost ?? 0;
    if (it.productId) {
      const qtyAt = async (wh?: Id) => {
        if (!wh) return 0;
        const [now, after] = await Promise.all([
          ProductStockModel.findOne({ tenantId, warehouseId: wh, productId: it.productId }).select("qty").lean<{ qty: number } | null>(),
          StockMovementModel.aggregate<{ q: number }>([{ $match: { tenantId: oid(tenantId), warehouseId: wh, productId: it.productId, createdAt: { $gt: at } } }, { $group: { _id: null, q: { $sum: "$quantity" } } }]),
        ]);
        return Math.max(0, (now?.qty ?? 0) - (after[0]?.q ?? 0));
      };
      [deskQty, reserveQty] = await Promise.all([qtyAt(desk?.warehouseId), qtyAt(desk?.reserveWarehouseId)]);
      const last = await StockMovementModel.findOne({ tenantId, productId: it.productId, createdAt: { $lte: at }, avgCostAfter: { $gt: 0 } }).sort({ createdAt: -1 }).select("avgCostAfter").lean<{ avgCostAfter?: number } | null>();
      cost = last?.avgCostAfter ?? (await ProductModel.findOne({ _id: it.productId, tenantId }).select("purchaseCost").lean<{ purchaseCost?: number } | null>())?.purchaseCost ?? cost;
    } else {
      const last = await ActivityStockMoveModel.findOne({ tenantId, deskId, itemId: it._id, date: { $lte: at } }).sort({ date: -1, createdAt: -1 }).select("quantityAfter").lean<{ quantityAfter: number } | null>();
      deskQty = Math.max(0, last?.quantityAfter ?? 0);
    }
    if (deskQty || reserveQty) rows.push({ name: it.name, category: it.category, unit: it.unit, reserve: reserveQty, desk: deskQty, unitCost: cost, value: Math.round((deskQty + reserveQty) * cost) });
  }
  return rows;
}

/** Douze mois glissants jusqu'au mois donné : CA, marge, charges, résultat (mois clos : leur instantané). */
export async function deskTrend(tenantId: string, deskId: string, month: string, n = 12) {
  const [y, m] = month.split("-").map(Number);
  const months = Array.from({ length: n }, (_, k) => { const d = new Date(y, m - 1 - (n - 1 - k), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const closes = new Map((await DeskMonthCloseModel.find({ tenantId, deskId, month: { $in: months }, status: "closed" }).select("month snapshot").lean<Array<{ month: string; snapshot: Pnl }>>()).map(c => [c.month, c.snapshot]));
  return Promise.all(months.map(async mo => {
    const p = closes.get(mo) ?? (await deskMonthResult(tenantId, deskId, mo)).pnl;
    return { month: mo, revenueHT: p.revenueHT, materialMargin: p.materialMargin, charges: p.totalCharges, result: p.result, foodCostPct: p.ratios?.foodCostPct ?? null, closed: closes.has(mo) };
  }));
}
