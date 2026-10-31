import { Types } from "mongoose";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityItemModel } from "@/models/ActivityItem";
import { CommandeModel } from "@/models/Commande";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { EmployeeModel } from "@/models/Employee";
import { PayslipModel } from "@/models/Payslip";
import { productSales } from "@/lib/comptoir-session";
import { deskMonthResult, maskPayroll, payrollHidden } from "@/lib/restaurant-result";
import { ProductModel } from "@/models/Product";
import { restaurantStock } from "@/lib/restaurant-stock";
import { monthBounds, staffCost, portionRecipe } from "@/lib/restaurant";
import { DEFAULT_TARGET_NET_MARGIN, priceCheck, targetGap, unitCostOf, type PriceCheck } from "@/lib/restaurant-pricing";

type Id = Types.ObjectId;
const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return monthOf(new Date(y, mo - 2, 1)); };

/**
 * Taux de frais de fonctionnement du comptoir, prudent : moyenne des trois
 * derniers mois complets qui ont des ventes ; pour chaque rubrique, le plus
 * élevé du prévu et du réel moyen ; rapporté au CA HT moyen. Démarque :
 * (pertes + repas du personnel et offerts − écarts d'inventaire + achats de
 * caisse hors réception) ÷ coût des ventes. « Provisoire » quand on retombe
 * sur le mois en cours ou que des bulletins du personnel manquent.
 */
export async function overheadRate(tenantId: string, deskId: string, now = new Date()) {
  const cur = monthOf(now);
  const months = [prevMonth(cur)]; months.push(prevMonth(months[0]), prevMonth(prevMonth(months[0])));
  let used = [] as Array<Awaited<ReturnType<typeof deskMonthResult>>>;
  for (const m of months) { const r = await deskMonthResult(tenantId, deskId, m); if (r.pnl.revenueHT > 0) used.push(r); }
  let provisional = false;
  if (!used.length) { const r = await deskMonthResult(tenantId, deskId, cur); if (r.pnl.revenueHT > 0) { used = [r]; provisional = true; } }
  if (!used.length) return { rate: 0, shrink: 0, months: [] as string[], charges: 0, revenueHT: 0, provisional: true, staffCount: 0 };
  const n = used.length, avg = (f: (r: typeof used[number]) => number) => used.reduce((t, r) => t + f(r), 0) / n;
  const revenue = avg(r => r.pnl.revenueHT);
  const cats = new Set(used.flatMap(r => r.pnl.charges.map(c => c.category)));
  let charges = 0;
  for (const c of cats) charges += Math.max(avg(r => r.pnl.charges.find(x => x.category === c)?.actual ?? 0), used[0].pnl.charges.find(x => x.category === c)?.planned ?? 0);
  const cost = avg(r => r.pnl.costOfSales);
  const shrinkAmount = avg(r => r.pnl.losses + r.pnl.staffAndOffered - r.pnl.inventoryGap + r.pnl.cashPurchases);
  if (used.some(r => r.warnings.some(w => w.startsWith("Bulletins du mois absents")))) provisional = true;
  return {
    rate: revenue > 0 ? charges / revenue : 0, shrink: cost > 0 ? Math.max(0, shrinkAmount / cost) : 0,
    months: used.map(r => r.month), charges: Math.round(charges), revenueHT: Math.round(revenue), provisional, staffCount: used[0].staffDetail.length,
  };
}

export interface PricingRow extends PriceCheck { itemId: string; name: string; category?: string; preparation: boolean; soldQty: number; lostMargin: number | null; avgPaidTTC: number | null }

/**
 * Prix et marge nette de chaque article vendu au comptoir : coût de revient
 * (recette comprise), part des frais de fonctionnement, marge nette et prix
 * minimum pour la cible du comptoir. `lostMargin` : ce que le mois de
 * référence aurait rapporté de plus au prix minimum, à volumes constants.
 */
export async function deskPricing(tenantId: string, deskId: string, canPayroll = true) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("name vatRate targetNetMargin").lean<{ name: string; vatRate?: number; targetNetMargin?: number } | null>();
  if (!desk) throw new Error("Comptoir introuvable");
  const target = desk.targetNetMargin ?? DEFAULT_TARGET_NET_MARGIN;
  const [items, oh] = await Promise.all([
    ActivityItemModel.find({ tenantId, deskId, archived: { $ne: true } }).select("name category unitCost salePrice recipe portions productId").lean<Array<{ _id: Id; name: string; category?: string; unitCost?: number; salePrice?: number; productId?: Id; portions?: number; recipe?: Array<{ itemId: Id; quantity: number; yield?: number }> }>>(),
    overheadRate(tenantId, deskId),
  ]);
  const ref = oh.months[0] ?? null;
  const b = ref ? monthBounds(ref) : null;
  const salesRows = b ? await productSales(tenantId, deskId, b.fromDay, b.toDay) : [];
  const sold = new Map(salesRows.map(s => [s.itemId, s.quantity]));
  // Prix moyen réellement encaissé (promotions, remises, prix saisis en caisse compris).
  const paid = new Map(salesRows.filter(s => s.quantity > 0).map(s => [s.itemId, Math.round(s.revenueTTC / s.quantity)]));
  // Coût retenu : le plus élevé du coût moyen et du dernier prix d'achat (prudent quand les prix montent).
  // TVA : celle de la vente (fiche du catalogue, sauf fiches du restaurant qui suivent le comptoir).
  const products = new Map((await ProductModel.find({ tenantId, _id: { $in: items.map(i => i.productId).filter(Boolean) } }).select("code tvaRate lastPurchaseCost").lean<Array<{ _id: Id; code?: string; tvaRate?: number; lastPurchaseCost?: number }>>()).map(p => [String(p._id), p]));
  const costs = new Map(items.map(i => { const p = i.productId ? products.get(String(i.productId)) : undefined; return [String(i._id), Math.max(i.unitCost ?? 0, p?.lastPurchaseCost ?? 0)]; }));
  const recipes = new Map(items.map(i => [String(i._id), { unitCost: i.unitCost, recipe: i.recipe?.length ? portionRecipe(i.recipe, i.portions).map(r => ({ itemId: String(r.itemId), quantity: r.quantity })) : undefined }]));
  const vatOf = (i: { productId?: Id }) => { const p = i.productId ? products.get(String(i.productId)) : undefined; return !desk.vatRate ? 0 : p && !p.code?.startsWith("RST-") && p.tvaRate !== undefined ? p.tvaRate : desk.vatRate; };
  const rows: PricingRow[] = items
    .filter(i => (i.salePrice ?? 0) > 0 || sold.has(String(i._id)))
    .map(i => {
      const own = recipes.get(String(i._id))!;
      const cost = own.recipe?.length ? unitCostOf(own, costs, recipes) : unitCostOf({ unitCost: costs.get(String(i._id)) }, costs);
      const c = priceCheck({ priceTTC: i.salePrice ?? 0, vatRate: vatOf(i), cost, overheadRate: oh.rate, shrinkRate: oh.shrink, target });
      const q = sold.get(String(i._id)) ?? 0;
      const lost = c.status === "below" && c.minPriceHT ? Math.round((c.minPriceHT - c.priceHT) * q) : null;
      return { ...c, itemId: String(i._id), name: i.name, category: i.category, preparation: !!i.recipe?.length, soldQty: q, lostMargin: lost, avgPaidTTC: paid.get(String(i._id)) ?? null };
    })
    .sort((a, b2) => (a.status === "below" ? 0 : 1) - (b2.status === "below" ? 0 : 1) || (b2.lostMargin ?? 0) - (a.lostMargin ?? 0) || a.name.localeCompare(b2.name));
  return {
    desk: { _id: deskId, name: desk.name, vatRate: desk.vatRate ?? 0, target },
    // Paie masquée (une ou deux personnes, lecteur sans droit paie) : seulement les taux, pas les montants dont on déduirait le salaire.
    overhead: { rate: Math.round(oh.rate * 1000) / 10, shrink: Math.round(oh.shrink * 1000) / 10, months: oh.months, provisional: oh.provisional,
      ...(payrollHidden(oh.staffCount, canPayroll) ? { charges: null, revenueHT: null } : { charges: oh.charges, revenueHT: oh.revenueHT }) },
    rows,
    counts: { below: rows.filter(r => r.status === "below").length, noCost: rows.filter(r => r.status === "no_cost").length, impossible: rows.some(r => r.status === "impossible") },
  };
}

/**
 * Vue d'ensemble des restaurants (comptoirs visibles) pour le mois : chiffre
 * d'affaires, marge, charges, résultat et marge nette face à la cible, ce
 * qu'il manque pour l'atteindre, et ce qui demande une action (stock,
 * péremptions, inventaire de la semaine, articles sous le prix minimum,
 * commandes à réceptionner, points d'attention du résultat).
 */
export async function restaurantOverview(tenantId: string, scope: string[] | null, month: string, canPayroll = true) {
  const desks = await ActivityDeskModel.find({ tenantId, archived: { $ne: true }, ...(scope ? { _id: { $in: scope } } : {}) }).select("name targetNetMargin").sort({ name: 1 })
    .lean<Array<{ _id: Id; name: string; targetNetMargin?: number }>>();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  // Un comptoir après l'autre : chaque calcul lit beaucoup (résultat, stock, prix), la base n'est pas noyée.
  const out = [] as Array<Awaited<ReturnType<typeof oneDesk>>>;
  for (const d of desks) out.push(await oneDesk(d));
  async function oneDesk(d: { _id: Id; name: string; targetNetMargin?: number }) {
    const id = String(d._id);
    const [r, stock, pricing, openInv, lastInv, orders] = await Promise.all([
      deskMonthResult(tenantId, id, month).then(x => maskPayroll(x, canPayroll)),
      restaurantStock(tenantId, id, true),
      deskPricing(tenantId, id, canPayroll),
      DeskInventoryModel.countDocuments({ tenantId, deskId: id, status: "open" }),
      DeskInventoryModel.findOne({ tenantId, deskId: id, status: "validated" }).sort({ validatedAt: -1 }).select("validatedAt number").lean<{ validatedAt: Date; number: string } | null>(),
      CommandeModel.find({ tenantId, sourceDeskId: d._id, status: { $in: ["confirmed", "partially_received"] } }).select("number supplierId status totalTTC").populate("supplierId", "name").lean<Array<{ _id: Id; number: string; supplierId?: { name?: string }; status: string; totalTTC?: number }>>(),
    ]);
    const target = d.targetNetMargin ?? DEFAULT_TARGET_NET_MARGIN;
    const rows = stock.rows.filter(x => !x.preparation);
    return {
      deskId: id, name: d.name, target: Math.round(target * 1000) / 10,
      revenueHT: r.pnl.revenueHT, materialMargin: r.pnl.materialMargin, charges: r.pnl.totalCharges, result: r.pnl.result,
      netMarginPct: r.pnl.ratios.resultPct, foodCostPct: r.pnl.ratios.foodCostPct, staffCostPct: r.pnl.ratios.staffCostPct, tickets: r.sales.tickets,
      gap: targetGap({ revenueHT: r.pnl.revenueHT, result: r.pnl.result, target }),
      stockValue: (stock.totals.desk ?? 0) + (stock.totals.reserve ?? 0),
      alerts: {
        low: rows.filter(x => x.lowDesk || x.lowReserve).length, toSupply: rows.filter(x => x.suggestion > 0).length,
        expiring: rows.filter(x => x.expiringQty > 0).length, expired: rows.filter(x => x.expiredQty > 0).length,
        belowMinPrice: pricing.counts.below, noCost: pricing.counts.noCost, openInventories: openInv,
        inventoryDue: !lastInv || lastInv.validatedAt < weekAgo, lastInventory: lastInv ? { at: lastInv.validatedAt, number: lastInv.number } : null,
        ordersToReceive: orders.map(o => ({ _id: String(o._id), number: o.number, supplier: o.supplierId?.name, status: o.status, totalTTC: o.totalTTC })),
        warnings: r.warnings,
      },
    };
  }
  const sum = (k: "revenueHT" | "materialMargin" | "charges" | "result") => out.reduce((t, x) => t + x[k], 0);
  const totals = { revenueHT: sum("revenueHT"), materialMargin: sum("materialMargin"), charges: sum("charges"), result: sum("result") };
  return { month, desks: out, totals: { ...totals, netMarginPct: totals.revenueHT ? Math.round((totals.result / totals.revenueHT) * 1000) / 10 : null } };
}

/**
 * Équipe des restaurants : le personnel affecté à chaque comptoir (part de son
 * temps) et, pour qui gère la paie, le coût employeur du mois imputé ; les
 * collaborateurs actifs encore affectés à aucun restaurant.
 */
export async function restaurantTeam(tenantId: string, scope: string[] | null, month: string, payroll: boolean) {
  const desks = await ActivityDeskModel.find({ tenantId, archived: { $ne: true }, ...(scope ? { _id: { $in: scope } } : {}) }).select("name staff").sort({ name: 1 })
    .lean<Array<{ _id: Id; name: string; staff?: Array<{ employeeId: Id; share: number }> }>>();
  const ids = [...new Set(desks.flatMap(d => (d.staff ?? []).map(s => String(s.employeeId))))];
  const b = monthBounds(month);
  const [emps, slips, free] = await Promise.all([
    EmployeeModel.find({ tenantId, _id: { $in: ids } }).select("firstName lastName position isActive").lean<Array<{ _id: Id; firstName: string; lastName: string; position?: string; isActive?: boolean }>>(),
    payroll ? PayslipModel.find({ tenantId, year: b.year, month: b.m, employeeId: { $in: ids } }).select("_id employeeId employerCost grossTotal cnssEmployer isPaid").lean<Array<{ _id: Id; employeeId: Id; employerCost?: number; grossTotal?: number; cnssEmployer?: number; isPaid?: boolean }>>() : Promise.resolve([]),
    EmployeeModel.find({ tenantId, isActive: true, _id: { $nin: ids } }).select("firstName lastName position").sort({ lastName: 1 }).limit(200).lean<Array<{ _id: Id; firstName: string; lastName: string; position?: string }>>(),
  ]);
  const byId = new Map(emps.map(e => [String(e._id), e]));
  return {
    month, payroll,
    desks: desks.map(d => ({
      deskId: String(d._id), name: d.name,
      staff: (d.staff ?? []).map(s => {
        const e = byId.get(String(s.employeeId)), own = slips.filter(p => String(p.employeeId) === String(s.employeeId));
        return {
          employeeId: String(s.employeeId), name: e ? `${e.lastName} ${e.firstName}` : "—", position: e?.position, active: e?.isActive !== false, share: s.share,
          ...(payroll ? { payslip: own.length > 0, payslipId: own[0] ? String(own[0]._id) : undefined, paid: own.some(p => p.isPaid), allocated: staffCost(own.map(p => ({ ...p, employeeId: String(p.employeeId) })), [{ employeeId: String(s.employeeId), share: s.share }]) } : {}),
        };
      }),
    })),
    unassigned: free.map(e => ({ employeeId: String(e._id), name: `${e.lastName} ${e.firstName}`, position: e.position })),
  };
}

/**
 * Après une hausse du coût d'achat : les articles du comptoir (l'ingrédient
 * lui-même ou les plats qui l'utilisent) désormais sous leur prix minimum,
 * avec le prix conseillé. Vide si rien ne bascule.
 */
export async function priceAlertsAfterCost(tenantId: string, deskId: string, ingredientIds: string[]) {
  if (!ingredientIds.length) return [];
  const users = await ActivityItemModel.find({ tenantId, deskId, archived: { $ne: true }, $or: [{ _id: { $in: ingredientIds } }, { "recipe.itemId": { $in: ingredientIds } }] }).select("_id").lean<Array<{ _id: Id }>>();
  if (!users.length) return [];
  const touched = new Set(users.map(u => String(u._id)));
  const { rows } = await deskPricing(tenantId, deskId);
  return rows.filter(r => touched.has(r.itemId) && r.status === "below" && r.minPriceTTC).map(r => ({ name: r.name, priceTTC: r.priceTTC, minPriceTTC: r.minPriceTTC!, netMarginPct: r.netMarginPct }));
}
