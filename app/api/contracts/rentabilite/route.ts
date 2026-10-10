import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { ContractModel } from "@/models/Contract";
import { marketFinance } from "@/lib/market-finance";

export const dynamic = "force-dynamic";

/** GET ?status= — rentabilité de tous les marchés clients, côte à côte. Gérant et comptabilité. */
export const GET = withAuth("contracts", "read", async (req: NextRequest, auth: TokenPayload) => {
  if (!hasFinanceAccess(auth)) return forbidden("Rentabilité réservée au gérant et à la comptabilité.");
  await connectDB();
  const status = new URL(req.url).searchParams.get("status");
  const contracts = await ContractModel.find({ ...tenantFilter(auth), type: "client", status: status ? status : { $nin: ["cancelled", "draft"] } })
    .populate("clientId", "name").sort({ createdAt: -1 }).limit(200)
    .lean<Array<{ _id: unknown; reference: string; title: string; status: string; amount: number; projectId?: unknown; devisId?: unknown; invoiceIds?: unknown[]; clientId?: { name?: string } }>>();
  const items = await Promise.all(contracts.map(async c => {
    const f = await marketFinance(auth.tenantId, c);
    return {
      _id: c._id, reference: c.reference, title: c.title, status: c.status, client: c.clientId?.name ?? "", hasProject: !!c.projectId,
      quoteHT: f.quote?.totalHT ?? null, contractHT: f.contractHT, workHT: f.billing.workHT, depositsOutstandingHT: f.billing.depositsOutstandingHT,
      collectedTTC: f.billing.collectedTTC, dueTTC: f.billing.dueTTC, toInvoiceHT: f.billing.toInvoiceHT,
      costActual: f.costs.actual, costCommitted: f.costs.committed, marginActual: f.margin.actual, marginActualRate: f.margin.actualRate,
      marginAtCompletion: f.margin.atCompletion, marginAtCompletionRate: f.margin.atCompletionRate,
    };
  }));
  const sum = (k: keyof (typeof items)[number]) => items.reduce((t, i) => t + (Number(i[k]) || 0), 0);
  return ok({
    items,
    totals: { contractHT: sum("contractHT"), workHT: sum("workHT"), costActual: sum("costActual"), costCommitted: sum("costCommitted"), marginActual: sum("marginActual"), marginAtCompletion: sum("marginAtCompletion"), dueTTC: sum("dueTTC") },
  });
});
