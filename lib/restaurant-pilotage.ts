import { Types } from "mongoose";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { DeskBudgetModel } from "@/models/DeskBudget";
import { FixedAssetModel } from "@/models/FixedAsset";
import { BusinessRuleError } from "@/lib/errors";
import { CHARGE_CATEGORIES, DEFAULT_VARIABLE_CATEGORIES, monthlyDepreciation, volumeSimulation } from "@/lib/restaurant";
import { deskMonthResult, deskTrend, maskPayroll, payrollHidden } from "@/lib/restaurant-result";
import { deskPricing } from "@/lib/restaurant-overview";
import { gasStats } from "@/lib/restaurant-standing";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { ItemCountModel } from "@/models/ItemCount";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const oid = (v: unknown) => new Types.ObjectId(String(v));
const mm = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
interface AssetLean { _id: Id; code: string; name: string; category: string; acquisitionDate: Date; acquisitionCost: number; residualValue?: number; usefulLifeYears?: number; depreciationMethod?: string; disposalDate?: Date; depreciationSchedule?: Array<{ year: number; annuity: number }>; deskId?: Id; status?: string }

/**
 * Pilotage d'un restaurant :
 *  - charges fixes et variables du mois, point mort, effet d'une baisse de 10, 20 et 30 % du volume ;
 *  - budget de l'année comparé au réel, mois par mois et en cumul ;
 *  - équipements rattachés et leur dotation du mois ;
 *  - clé de répartition des charges du secteur partagé.
 * Qui ne lit pas la paie, sur un restaurant de moins de trois personnes, voit tout avant personnel.
 */
export async function pilotage(tenantId: string, deskId: string, month: string, canPayroll: boolean, finance: boolean) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("name activityId staff sectorShare commonCostShare variableCategories gasBottles openDaysPerMonth").lean<{ _id: Id; name: string; activityId?: Id; staff?: unknown[]; sectorShare?: number; commonCostShare?: number; variableCategories?: string[]; gasBottles?: Array<{ startedAt: Date }>; openDaysPerMonth?: number } | null>();
  if (!desk) throw new BusinessRuleError("Restaurant introuvable.");
  const [year, m] = month.split("-").map(Number);
  const raw = await deskMonthResult(tenantId, deskId, month);
  const hide = payrollHidden(raw.staffDetail.length, canPayroll);
  const r = maskPayroll(raw, canPayroll);
  const variableCats = desk.variableCategories ?? DEFAULT_VARIABLE_CATEGORIES;

  // Budget de l'année et réel des mois écoulés (jusqu'au mois choisi).
  const budget = await DeskBudgetModel.findOne({ tenantId, deskId, year }).lean<{ revenue: number[]; materialPct: number; charges: Array<{ category: string; annual: number }>; note?: string; updatedAt: Date } | null>();
  const actual = await deskTrend(tenantId, deskId, month, m, hide);
  const budgetCharges = (budget?.charges ?? []).filter(c => !(hide && c.category === "personnel"));
  const monthlyCharges = budgetCharges.reduce((t, c) => t + c.annual, 0) / 12;
  const months = Array.from({ length: 12 }, (_, k) => {
    const rev = budget?.revenue[k] ?? 0, mat = rev * (budget?.materialPct ?? 0);
    const b = budget ? { revenueHT: Math.round(rev), materialMargin: Math.round(rev - mat), charges: Math.round(monthlyCharges), result: Math.round(rev - mat - monthlyCharges) } : null;
    const a = actual.find(x => x.month === mm(year, k + 1)) ?? null;
    return { month: mm(year, k + 1), budget: b, actual: a ? { revenueHT: a.revenueHT, materialMargin: a.materialMargin, charges: a.charges, result: a.result, closed: a.closed } : null };
  });
  const sum = (f: (x: typeof months[number]) => number | undefined) => months.filter(x => x.actual).reduce((t, x) => t + (f(x) ?? 0), 0);
  const ytd = budget ? {
    budgetRevenue: sum(x => x.budget?.revenueHT), actualRevenue: sum(x => x.actual?.revenueHT),
    budgetResult: sum(x => x.budget?.result), actualResult: sum(x => x.actual?.result),
  } : null;

  // Équipements.
  const linked = await FixedAssetModel.find({ tenantId, deskId, status: { $ne: "disposed" } }).select("code name category acquisitionDate acquisitionCost residualValue usefulLifeYears depreciationMethod disposalDate depreciationSchedule").sort({ name: 1 }).lean<AssetLean[]>();
  const linkable = finance ? await FixedAssetModel.find({ tenantId, deskId: { $exists: false }, status: "active", category: { $nin: ["land", "building"] } }).select("code name category acquisitionCost").sort({ name: 1 }).limit(300).lean<AssetLean[]>() : [];

  // Répartition des charges du secteur.
  const sector = desk.activityId ? await ActivityDeskModel.find({ tenantId, activityId: desk.activityId, archived: { $ne: true } }).select("name sectorShare").sort({ name: 1 }).lean<Array<{ _id: Id; name: string; sectorShare?: number }>>() : [];

  return {
    month, desk: { _id: String(desk._id), name: desk.name }, payrollHidden: hide, finance,
    simulation: { ...volumeSimulation(r.pnl, variableCats), variableCategories: variableCats, result: r.pnl.result, resultPct: r.pnl.ratios.resultPct, provisional: month >= mm(new Date().getFullYear(), new Date().getMonth() + 1) },
    gas: gasStats(desk.gasBottles ?? [], month, r.pnl.charges.find(c => c.category === "energie")?.actual ?? 0, r.sales.tickets, desk.openDaysPerMonth ?? 26),
    categories: Object.entries(CHARGE_CATEGORIES).map(([k, label]) => ({ key: k, label })),
    budget: budget ? { revenue: budget.revenue, materialPct: budget.materialPct, charges: budget.charges.filter(c => !(hide && c.category === "personnel")), note: budget.note, updatedAt: budget.updatedAt } : null,
    months, ytd,
    assets: linked.map(a => ({ _id: String(a._id), code: a.code, name: a.name, category: a.category, acquisitionDate: a.acquisitionDate, acquisitionCost: a.acquisitionCost, depreciationMethod: a.depreciationMethod ?? "linear", usefulLifeYears: a.usefulLifeYears ?? 5, monthly: monthlyDepreciation(a, year, m) })),
    linkable: linkable.map(a => ({ _id: String(a._id), code: a.code, name: a.name, category: a.category, acquisitionCost: a.acquisitionCost })),
    allocation: { commonCostShare: desk.commonCostShare ?? 0, sector: sector.map(s => ({ deskId: String(s._id), name: s.name, sectorShare: s.sectorShare ?? null })) },
  };
}

/** Budget de l'année d'un restaurant (remplace le précédent). */
export async function saveBudget(auth: TokenPayload, deskId: string, year: number, b: { revenue?: unknown; materialPct?: unknown; charges?: unknown; note?: unknown }) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BusinessRuleError("Année invalide.");
  const revenue = Array.isArray(b.revenue) ? b.revenue.map(Number) : [];
  if (revenue.length !== 12 || revenue.some(n => !Number.isFinite(n) || n < 0)) throw new BusinessRuleError("Chiffre d'affaires : douze montants positifs, un par mois.");
  const pct = Number(b.materialPct);
  if (!(pct >= 0 && pct < 1)) throw new BusinessRuleError("Coût matière visé : entre 0 et 100 % du CA.");
  const charges = (Array.isArray(b.charges) ? b.charges as Array<{ category?: unknown; annual?: unknown }> : [])
    .filter(c => typeof c.category === "string" && c.category in CHARGE_CATEGORIES && Number(c.annual) > 0)
    .map(c => ({ category: String(c.category), annual: Math.round(Number(c.annual)) }));
  if (new Set(charges.map(c => c.category)).size !== charges.length) throw new BusinessRuleError("Une même rubrique figure deux fois.");
  await DeskBudgetModel.updateOne({ tenantId: auth.tenantId, deskId, year },
    { $set: { revenue: revenue.map(n => Math.round(n)), materialPct: Math.round(pct * 1000) / 1000, charges, note: typeof b.note === "string" ? b.note.slice(0, 300) : undefined, updatedBy: auth.userId } }, { upsert: true });
}

/**
 * Clé de répartition : part du secteur partagé portée par chaque comptoir
 * (le total ne dépasse pas 100 %), et rubriques de charges variables.
 */
export async function saveAllocation(auth: TokenPayload, deskId: string, a: { shares?: unknown; variableCategories?: unknown }) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("activityId").lean<{ activityId?: Id } | null>();
  if (!desk) throw new BusinessRuleError("Restaurant introuvable.");
  if (a.variableCategories !== undefined) {
    const cats = Array.isArray(a.variableCategories) ? [...new Set(a.variableCategories.map(String).filter(c => c in CHARGE_CATEGORIES))] : [];
    await ActivityDeskModel.updateOne({ _id: deskId, tenantId: auth.tenantId }, { $set: { variableCategories: cats } });
  }
  if (a.shares !== undefined) {
    if (!desk.activityId) throw new BusinessRuleError("Ce comptoir n'a pas de secteur analytique : rien à répartir.");
    const sector = await ActivityDeskModel.find({ tenantId: auth.tenantId, activityId: desk.activityId, archived: { $ne: true } }).select("_id").lean<Array<{ _id: Id }>>();
    const ids = new Set(sector.map(s => String(s._id)));
    const list = Array.isArray(a.shares) ? a.shares as Array<{ deskId?: unknown; share?: unknown }> : [];
    const shares = list.filter(s => ids.has(String(s.deskId))).map(s => ({ deskId: String(s.deskId), share: s.share === null || s.share === "" || s.share === undefined ? null : Number(s.share) }));
    if (shares.some(s => s.share !== null && !(s.share >= 0 && s.share <= 1))) throw new BusinessRuleError("Part invalide (entre 0 et 100 %).");
    const set = shares.filter(s => s.share !== null);
    // Toutes fixées ou aucune : un mélange laisserait les autres à « parts égales » et ferait dépasser 100 %.
    if (set.length && set.length !== ids.size) throw new BusinessRuleError("Fixez la part de chaque comptoir du secteur, ou d'aucun (parts égales).");
    const total = set.reduce((t, s) => t + (s.share ?? 0), 0);
    if (total > 1.0001) throw new BusinessRuleError(`Les parts dépassent 100 % (${Math.round(total * 1000) / 10} %).`);
    for (const id of ids) {
      const s = set.find(x => x.deskId === id);
      await ActivityDeskModel.updateOne({ _id: id, tenantId: auth.tenantId }, s ? { $set: { sectorShare: Math.round((s.share ?? 0) * 10000) / 10000 } } : { $unset: { sectorShare: 1 } });
    }
    return { total: Math.round(total * 1000) / 10 };
  }
  return {};
}

/** Rattache un équipement du registre des immobilisations au restaurant, ou l'en détache. */
export async function linkAsset(auth: TokenPayload, deskId: string, assetId: string, link: boolean) {
  const r = link
    ? await FixedAssetModel.updateOne({ _id: assetId, tenantId: auth.tenantId, deskId: { $exists: false }, category: { $nin: ["land", "building"] } }, { $set: { deskId } })
    : await FixedAssetModel.updateOne({ _id: assetId, tenantId: auth.tenantId, deskId }, { $unset: { deskId: 1 } });
  if (r.modifiedCount !== 1) throw new BusinessRuleError(link ? "Équipement introuvable ou déjà rattaché à un restaurant." : "Équipement non rattaché à ce restaurant.");
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Rapport du lundi d'un restaurant : la semaine écoulée (lundi à dimanche) —
 * tickets, CA HT, coût matière, pertes et écarts d'inventaire — puis le mois
 * (le mois écoulé tant qu'on est dans la première semaine, sinon le mois en
 * cours) : résultat et marge nette contre l'objectif, prix sous le minimum.
 * `today` : le lundi du rapport.
 */
export async function weeklyReport(tenantId: string, deskId: string, today: Date, canPayroll: boolean) {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7), to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const last = new Date(to.getTime() - 1);
  const match = { tenantId: oid(tenantId), deskId: oid(deskId), status: { $ne: "cancelled" }, date: { $gte: from, $lt: to } };
  const [sales, losses, gaps] = await Promise.all([
    ComptoirSaleModel.aggregate<{ tickets: number; ht: number; cost: number }>([{ $match: match }, { $group: { _id: null, tickets: { $sum: 1 }, ht: { $sum: "$totalHT" }, cost: { $sum: { $sum: "$lines.costTotal" } } } }]),
    ActivityStockMoveModel.aggregate<{ v: number }>([{ $match: { tenantId: oid(tenantId), deskId: oid(deskId), lossReason: { $exists: true, $nin: ["inventory"] }, date: { $gte: from, $lt: to } } }, { $group: { _id: null, v: { $sum: "$lossValue" } } }]),
    ItemCountModel.aggregate<{ v: number }>([{ $match: { tenantId: oid(tenantId), deskId: oid(deskId), day: { $gte: dayKey(from), $lte: dayKey(last) } } }, { $group: { _id: null, v: { $sum: "$gapValue" } } }]),
  ]);
  const ht = Math.round(sales[0]?.ht ?? 0), cost = Math.round(sales[0]?.cost ?? 0);
  const firstWeek = today.getDate() <= 7;
  const md = firstWeek ? new Date(today.getFullYear(), today.getMonth() - 1, 1) : today;
  const month = mm(md.getFullYear(), md.getMonth() + 1);
  const r = maskPayroll(await deskMonthResult(tenantId, deskId, month), canPayroll);
  const pricing = await deskPricing(tenantId, deskId, canPayroll);
  return {
    week: { from: dayKey(from), to: dayKey(last), tickets: sales[0]?.tickets ?? 0, revenueHT: ht, foodCostPct: ht > 0 ? Math.round((cost / ht) * 1000) / 10 : null, losses: Math.round(losses[0]?.v ?? 0), inventoryGap: Math.round(gaps[0]?.v ?? 0) },
    month: { month, complete: firstWeek, revenueHT: r.pnl.revenueHT, result: r.pnl.result, resultPct: r.pnl.ratios.resultPct, target: Math.round(r.desk.target * 100), gapToTarget: r.target?.missing ?? null, beforeStaff: !!(r as { payrollHidden?: boolean }).payrollHidden },
    belowMinPrice: pricing.counts.below,
  };
}
