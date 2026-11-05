import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { contractFields, contractUpdate, MARKET_TERMS } from "@/lib/contract-input";
import { authCan, hasFinanceAccess } from "@/lib/role-resources";
import { InvoiceModel } from "@/models/Invoice";
import { dueFrom, paymentDaysOf } from "@/lib/market-terms";

// `withAuth` passe les paramètres de route en TROISIÈME argument, déjà résolus.
// Le code lisait `context.params.id` sur ce qui est en réalité l'objet des
// paramètres : `id` valait toujours undefined et les trois méthodes de cette
// route répondaient 404 quelle que soit la requête.
export const GET = withAuth("contracts", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  
  const id = params.id;
  if (!id) return notFound();

  const contract = await ContractModel.findOne({ _id: id, ...tenantFilter(auth) })
    .populate("clientId", "name code nif address phone email")
    .populate("supplierId", "name code")
    .populate("employeeId", "firstName lastName code position")
    // Montants facturés : visibles de la comptabilité et du gérant seulement.
    .populate("invoiceIds", authCan(auth, "invoices", "read") ? "number totalTTC status issueDate" : "number status issueDate")
    .populate("projectId", "code name status")
    .populate("devisId", "number status")
    .lean();

  if (!contract) return notFound();
  return ok(contract);
});

export const PATCH = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  
  const id = params.id;
  if (!id) return notFound();

  const body = await req.json().catch(() => ({}));
  // Liste blanche : ni l'organisation, ni la référence, ni les factures liées ne se réécrivent.
  const { data, error } = await contractFields(auth.tenantId, body);
  if (error) return badRequest(error);
  // Ces conditions déplacent des échéances et changent la marge : gérant et comptabilité.
  if (MARKET_TERMS.some(k => k in data) && !hasFinanceAccess(auth)) return forbidden("Conditions financières du marché : réservées au gérant et à la comptabilité.");
  const contract = await ContractModel.findOneAndUpdate(
    { _id: id, ...tenantFilter(auth) },
    contractUpdate(data),
    { new: true, runValidators: true },
  ).populate("clientId", "name code");

  if (!contract) return notFound();

  // Délai modifié : les factures dont la déclaration est datée suivent le nouveau délai.
  if ("paymentDays" in data) {
    const claimed = await InvoiceModel.find({ ...tenantFilter(auth), contractId: contract._id, claimReceivedAt: { $exists: true } }).select("claimReceivedAt status").lean<Array<{ _id: unknown; claimReceivedAt: Date; status: string }>>();
    for (const i of claimed) {
      const dueDate = dueFrom(i.claimReceivedAt, paymentDaysOf(contract));
      // Une facture en retard ne l'est plus si le nouveau délai n'est pas échu.
      await InvoiceModel.updateOne({ _id: i._id }, { $set: { dueDate, ...(i.status === "overdue" && dueDate >= new Date() ? { status: "sent" } : {}) } });
    }
  }

  await logAudit(auth, "UPDATE", "contracts", { resourceId: id });
  return ok(contract);
});

export const DELETE = withAuth("contracts", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  
  const id = params.id;
  if (!id) return notFound();

  const contract = await ContractModel.findOneAndUpdate(
    { _id: id, ...tenantFilter(auth) }, 
    { status: "cancelled" }, 
    { new: true }
  );

  if (!contract) return notFound();
  
  await logAudit(auth, "DELETE", "contracts", { resourceId: id });
  return noContent();
});