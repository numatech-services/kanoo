import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { reverseSaleEntry } from "@/lib/invoice-entry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * POST — annule une facture non réglée. Son écriture de vente est extournée
 * (le chiffre d'affaires et la créance disparaissent), ce que l'ancienne
 * version ne faisait pas. Une facture certifiée ne s'annule pas : avoir.
 */
export const POST = withAuth("invoices", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const invoice = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!invoice) return notFound();
  if (invoice.status === "cancelled") return badRequest("Facture déjà annulée");
  if (invoice.status === "paid") return badRequest("Impossible d'annuler une facture soldée");
  if (invoice.paidAmount > 0) return badRequest("Impossible d'annuler une facture partiellement payée");
  if (invoice.secef?.code) return badRequest("Facture certifiée : elle s'annule par un avoir.");
  await withTransaction(async session => {
    invoice.status = "cancelled";
    await invoice.save({ session });
    await reverseSaleEntry({ tenantId: auth.tenantId, userId: auth.userId, invoiceId: invoice._id, reason: "facture annulée" }, session);
  });
  await logAudit(auth, "UPDATE", "invoices", { resourceId: params.id, after: { status: "cancelled" } });
  return ok(invoice);
});
