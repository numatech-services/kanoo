import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, forbidden, ok, badRequest, notFound, conflict, tenantFilter } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";

/**
 * POST { invoiceId } — rattache une facture existante au marché.
 *
 * Le test de doublon comparait des ObjectId à une chaîne (toujours faux : la
 * facture était ajoutée à chaque appel) ; `contractId` n'était pas posé sur la
 * facture, si bien que le plafond du marché l'ignorait ; et une facture d'un
 * autre client pouvait être rattachée.
 */
export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "invoices", "read")) return forbidden("Rattachement de facture réservé à la comptabilité et au gérant.");
  await connectDB();
  const { invoiceId } = await req.json().catch(() => ({}));
  if (!invoiceId) return badRequest("invoiceId requis");

  const [contract, invoice] = await Promise.all([
    ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) }),
    InvoiceModel.findOne({ _id: invoiceId, ...tenantFilter(auth) }),
  ]);
  if (!contract) return notFound("Contrat introuvable");
  if (!invoice) return notFound("Facture introuvable");
  if (invoice.documentType === "credit_note") return badRequest("Un avoir suit sa facture : rattachez la facture d'origine.");
  if (String(invoice.clientId) !== String(contract.clientId)) return badRequest("Cette facture n'est pas adressée au client du marché.");
  if (invoice.contractId && String(invoice.contractId) !== String(contract._id)) return conflict("Cette facture est déjà rattachée à un autre marché.");

  const already = contract.invoiceIds.some((id: unknown) => String(id) === String(invoice._id));
  await withTransaction(async session => {
    if (!already) { contract.invoiceIds.push(invoice._id); await contract.save({ session }); }
    if (!invoice.contractId) await InvoiceModel.updateOne({ _id: invoice._id }, { $set: { contractId: contract._id } }, { session });
  });
  await logAudit(auth, "UPDATE", "contracts", { resourceId: params.id, metadata: { linkedInvoice: String(invoice._id) } });
  return ok({ message: already ? "Facture déjà liée au contrat" : "Facture liée au contrat", contract });
});
