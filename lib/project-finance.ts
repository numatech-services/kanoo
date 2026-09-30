import { Types } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";

export interface ProjectFinance { cost: number; revenue: number; margin: number }

/**
 * Coût et recettes réels d'un ou plusieurs projets, lus dans la comptabilité :
 * lignes de charges (classe 6) et de produits (classe 7) imputées au projet —
 * achats et dépenses, notes de frais, charges récurrentes, factures de vente,
 * écritures manuelles. Les extournes portent la même imputation et s'annulent
 * d'elles-mêmes.
 */
export async function projectFinance(tenantId: string, projectIds: unknown[]): Promise<Map<string, ProjectFinance>> {
  const ids = projectIds.map(id => new Types.ObjectId(String(id)));
  const out = new Map<string, ProjectFinance>();
  if (ids.length === 0) return out;
  const rows = await AccountingEntryModel.aggregate<{ _id: { p: Types.ObjectId; c: string }; debit: number; credit: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), "lines.projectId": { $in: ids } } },
    { $unwind: "$lines" },
    { $match: { "lines.projectId": { $in: ids }, "lines.accountCode": { $regex: "^[67]" } } },
    { $group: { _id: { p: "$lines.projectId", c: { $substrCP: ["$lines.accountCode", 0, 1] } }, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
  ]);
  for (const r of rows) {
    const key = String(r._id.p);
    const cur = out.get(key) ?? { cost: 0, revenue: 0, margin: 0 };
    if (r._id.c === "6") cur.cost += r.debit - r.credit;
    else cur.revenue += r.credit - r.debit;
    cur.margin = cur.revenue - cur.cost;
    out.set(key, cur);
  }
  return out;
}
