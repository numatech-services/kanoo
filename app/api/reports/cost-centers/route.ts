import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { costCenterLabels } from "@/lib/cost-centers-server";
import { parsePeriod, periodMatch } from "@/lib/flow-filter";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/cost-centers?from=&to= — charges et produits HT par
 * service, d'après les lignes d'écriture imputées (paie, achats, notes de
 * frais, charges récurrentes…). Les charges non imputées sont regroupées à part.
 */
export const GET = withAuth("analytics", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const period = parsePeriod(new URL(req.url));
  const rows = await AccountingEntryModel.aggregate<{ _id: { c: string | null; k: string }; total: number }>([
    { $match: { ...tenantFilter(auth), ...periodMatch("entryDate", period) } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": { $regex: "^[67]" } } },
    { $group: {
      _id: { c: { $ifNull: ["$lines.costCenter", null] }, k: { $substrCP: ["$lines.accountCode", 0, 2] } },
      total: { $sum: { $subtract: ["$lines.debit", "$lines.credit"] } },
    } },
  ]);
  const labels = await costCenterLabels(auth.tenantId);
  const by = new Map<string, { key: string; label: string; expense: number; revenue: number; payroll: number; purchases: number }>();
  for (const r of rows) {
    const key = r._id.c ?? "_none";
    const cur = by.get(key) ?? { key, label: r._id.c ? labels[r._id.c] ?? r._id.c : "Non imputé", expense: 0, revenue: 0, payroll: 0, purchases: 0 };
    if (r._id.k.startsWith("7")) cur.revenue += -r.total;
    else {
      cur.expense += r.total;
      if (r._id.k === "66") cur.payroll += r.total;
      if (r._id.k === "60") cur.purchases += r.total;
    }
    by.set(key, cur);
  }
  const items = [...by.values()].map(x => ({ ...x, result: x.revenue - x.expense }))
    .sort((a, b) => (a.key === "_none" ? 1 : b.key === "_none" ? -1 : b.expense - a.expense));
  return ok({ items, totals: items.reduce((t, x) => ({ expense: t.expense + x.expense, revenue: t.revenue + x.revenue }), { expense: 0, revenue: 0 }) });
});
