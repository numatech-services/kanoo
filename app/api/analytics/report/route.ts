import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { parsePeriod, periodMatch } from "@/lib/flow-filter";
import { ActivityModel } from "@/models/Activity";
import { AnalyticEntryModel } from "@/models/AnalyticEntry";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { isTenantAdmin } from "@/lib/roles-ui";
import { UserRole } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/report?from=&to= — rentabilité par secteur.
 * Le total CONSOLIDÉ (santé financière d'ensemble) n'est renvoyé qu'aux
 * administrateurs du compte ; les autres rôles voient le détail par secteur
 * mais pas le résultat net global.
 */
export const GET = withAuth("analytics", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const match: Record<string, unknown> = { ...tenantFilter(auth) };
  // Même lecture de période que les listes (date de fin incluse).
  Object.assign(match, periodMatch("date", parsePeriod(url)));

  // Écritures comptables imputées à un secteur (factures de vente, achats,
  // notes de frais, charges récurrentes…) : classe 7 = recette, classe 6 = charge.
  const entryMatch: Record<string, unknown> = { ...tenantFilter(auth), "lines.activityId": { $exists: true } };
  if (match.date) entryMatch.entryDate = match.date;
  const [activities, agg, desks, cashAgg, entryAgg] = await Promise.all([
    ActivityModel.find({ ...tenantFilter(auth) }).select("name color").lean<{ _id: Types.ObjectId; name: string; color?: string }[]>(),
    AnalyticEntryModel.aggregate([
      { $match: match },
      { $group: { _id: { activityId: "$activityId", kind: "$kind" }, total: { $sum: "$amount" } } },
    ]),
    // Comptoirs (The Spot…) rattachés à un secteur : leur caisse remonte dans la
    // rentabilité de ce secteur (in → recette, out → dépense).
    ActivityDeskModel.find({ ...tenantFilter(auth) }).select("activityId").lean<{ _id: Types.ObjectId; activityId?: Types.ObjectId }[]>(),
    ActivityCashEntryModel.aggregate([
      { $match: match },
      { $group: { _id: { deskId: "$deskId", direction: "$direction" }, total: { $sum: "$amount" } } },
    ]),
    AccountingEntryModel.aggregate<{ _id: { a: Types.ObjectId; c: string }; debit: number; credit: number }>([
      { $match: entryMatch },
      { $unwind: "$lines" },
      { $match: { "lines.activityId": { $exists: true, $ne: null }, "lines.accountCode": { $regex: "^[67]" } } },
      { $group: { _id: { a: "$lines.activityId", c: { $substrCP: ["$lines.accountCode", 0, 1] } }, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
    ]),
  ]);

  // Assemble : { activityId → { revenue, expense } }, plus « général » (activityId null).
  const byActivity = new Map<string, { revenue: number; expense: number }>();
  let genRevenue = 0, genExpense = 0;
  for (const row of agg) {
    const key = row._id.activityId ? String(row._id.activityId) : null;
    if (key === null) { if (row._id.kind === "revenue") genRevenue += row.total; else genExpense += row.total; continue; }
    const cur = byActivity.get(key) || { revenue: 0, expense: 0 };
    if (row._id.kind === "revenue") cur.revenue += row.total; else cur.expense += row.total;
    byActivity.set(key, cur);
  }

  // Caisse des comptoirs : rattachée au secteur du comptoir s'il en a un, sinon
  // versée aux frais généraux (elle reste de l'argent réel du compte).
  const deskActivity = new Map<string, string | null>();
  for (const d of desks) deskActivity.set(String(d._id), d.activityId ? String(d.activityId) : null);
  for (const row of cashAgg) {
    const key = deskActivity.get(String(row._id.deskId)) ?? null;
    const isRevenue = row._id.direction === "in";
    if (key === null) { if (isRevenue) genRevenue += row.total; else genExpense += row.total; continue; }
    const cur = byActivity.get(key) || { revenue: 0, expense: 0 };
    if (isRevenue) cur.revenue += row.total; else cur.expense += row.total;
    byActivity.set(key, cur);
  }

  // Comptabilité : recettes et charges imputées au secteur.
  const fromAccounting = new Map<string, { revenue: number; expense: number }>();
  for (const row of entryAgg) {
    const key = String(row._id.a);
    const cur = byActivity.get(key) || { revenue: 0, expense: 0 };
    const acc = fromAccounting.get(key) || { revenue: 0, expense: 0 };
    if (row._id.c === "7") { cur.revenue += row.credit - row.debit; acc.revenue += row.credit - row.debit; }
    else { cur.expense += row.debit - row.credit; acc.expense += row.debit - row.credit; }
    byActivity.set(key, cur); fromAccounting.set(key, acc);
  }

  const sectors = activities.map((a) => {
    const v = byActivity.get(String(a._id)) || { revenue: 0, expense: 0 };
    return { activityId: String(a._id), name: a.name, color: a.color, revenue: v.revenue, expense: v.expense, result: v.revenue - v.expense,
      fromAccounting: fromAccounting.get(String(a._id)) ?? { revenue: 0, expense: 0 } };
  }).sort((x, y) => y.result - x.result);

  const admin = isTenantAdmin(auth.role as UserRole) || (auth.roles ?? []).some(r => isTenantAdmin(r as UserRole));
  const totalRevenue = sectors.reduce((s, x) => s + x.revenue, 0) + genRevenue;
  const totalExpense = sectors.reduce((s, x) => s + x.expense, 0) + genExpense;

  return ok({
    sectors,
    general: { revenue: genRevenue, expense: genExpense },
    // Consolidé réservé à l'administrateur.
    consolidated: admin ? { revenue: totalRevenue, expense: totalExpense, result: totalRevenue - totalExpense } : null,
    isAdmin: admin,
  });
});
