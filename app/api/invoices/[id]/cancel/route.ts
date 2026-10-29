import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { DevisModel } from "@/models/Devis";
import { reverseSaleEntry } from "@/lib/invoice-entry";
import { releaseMarketInvoice } from "@/lib/market-invoice";
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
  // Cas où l'extourne de la vente fausserait la comptabilité : l'avoir déjà
  // émis resterait comptabilisé (411 crédité deux fois), la créance douteuse
  // ou la perte (416, 491, 651) resteraient en place.
  if (invoice.documentType === "credit_note") return badRequest("Un avoir ne s'annule pas ici.");
  if ((invoice.creditedAmount ?? 0) > 0) return badRequest("Un avoir a déjà été émis sur cette facture : émettez un avoir complémentaire plutôt que d'annuler.");
  if (invoice.status === "written_off") return badRequest("Facture passée en perte : elle ne s'annule plus.");
  if (invoice.doubtfulAt) return badRequest("Créance douteuse : régularisez par un avoir (la dépréciation est reprise avec lui).");
  if (invoice.kind === "deposit" && (invoice.depositUsedHT ?? 0) > 0) return badRequest("Acompte déjà déduit sur une facture du marché : annulez d'abord celle-ci.");
  // Facture livrée : l'annuler laisserait la marchandise sortie sans vente.
  if (await DeliveryNoteModel.exists({ tenantId: auth.tenantId, invoiceId: invoice._id, status: { $ne: "returned" } })) {
    return badRequest("Des bons de livraison sont établis sur cette facture : passez-les en « retourné » (la marchandise revient en stock), ou émettez un avoir.");
  }
  await withTransaction(async session => {
    invoice.status = "cancelled";
    await invoice.save({ session });
    // Facture de marché : acomptes déduits libérés, échéance de nouveau à facturer.
    await releaseMarketInvoice(auth.tenantId, invoice, session);
    // Devis d'origine : de nouveau transformable (il restait bloqué « déjà converti » sur une facture annulée).
    await DevisModel.updateMany({ tenantId: auth.tenantId, convertedToInvoiceId: invoice._id }, { $unset: { convertedToInvoiceId: 1 } }, { session });
    await reverseSaleEntry({ tenantId: auth.tenantId, userId: auth.userId, invoiceId: invoice._id, reason: "facture annulée" }, session);
  });
  await logAudit(auth, "UPDATE", "invoices", { resourceId: params.id, after: { status: "cancelled" } });
  return ok(invoice);
});
