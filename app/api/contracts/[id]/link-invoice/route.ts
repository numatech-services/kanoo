import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";
import { TokenPayload } from "@/lib/auth";

export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const { invoiceId } = await req.json();
  if (!invoiceId) return badRequest("invoiceId requis");

  const [contract, invoice] = await Promise.all([
    ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) }),
    InvoiceModel.findOne({ _id: invoiceId, ...tenantFilter(auth) }),
  ]);
  if (!contract) return notFound("Contrat introuvable");
  if (!invoice) return notFound("Facture introuvable");

  if (!contract.invoiceIds.includes(invoiceId)) {
    contract.invoiceIds.push(invoiceId);
    await contract.save();
  }
  return ok({ message: "Facture liée au contrat", contract });
});
