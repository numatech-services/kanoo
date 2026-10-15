import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";

export const dynamic = "force-dynamic";

/**
 * GET — marchés en exécution issus d'appels d'offres gagnés : nombre, montant
 * HT et part déjà facturée (avoirs déduits). Pour l'onglet « Marchés obtenus ».
 */
export const GET = withAuth("appels", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!authCan(auth, "contracts", "read")) return ok({ executing: null, contracts: [] });
  const contracts = await ContractModel.find({ ...tenantFilter(auth), appelId: { $exists: true }, status: { $in: ["active", "renewed", "suspended", "expired"] } })
    .select("reference title amount status appelId endDate").lean<Array<{ _id: Types.ObjectId; reference: string; title: string; amount: number; status: string; appelId: Types.ObjectId; endDate?: Date }>>();
  const billed = contracts.length ? await InvoiceModel.aggregate<{ _id: Types.ObjectId; ht: number }>([
    { $match: { tenantId: new Types.ObjectId(auth.tenantId), contractId: { $in: contracts.map(c => c._id) }, status: { $nin: ["draft", "cancelled"] } } },
    { $group: { _id: "$contractId", ht: { $sum: { $multiply: ["$totalHT", { $cond: [{ $eq: ["$documentType", "credit_note"] }, -1, 1] }] } } } },
  ]) : [];
  const byId = new Map(billed.map(b => [String(b._id), b.ht]));
  const rows = contracts.map(c => ({ _id: String(c._id), reference: c.reference, title: c.title, amount: c.amount, status: c.status, appelId: String(c.appelId), endDate: c.endDate, invoicedHT: Math.max(0, byId.get(String(c._id)) ?? 0) }));
  const active = rows.filter(r => ["active", "renewed"].includes(r.status));
  const amount = active.reduce((t, r) => t + r.amount, 0);
  const invoiced = active.reduce((t, r) => t + Math.min(r.amount, r.invoicedHT), 0);
  return ok({ executing: { count: active.length, amount, invoicedRate: amount > 0 ? Math.round((invoiced / amount) * 100) : 0 }, contracts: rows });
});
