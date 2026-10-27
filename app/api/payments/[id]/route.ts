import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, conflict, noContent, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PaymentModel } from "@/models/Payment";
import { InvoiceModel } from "@/models/Invoice";
import { applyPaymentEffects, invoiceDue } from "@/lib/payments";
import { logAudit } from "@/lib/audit";
import { paymentDate } from "@/lib/payment-date";
import { BusinessRuleError } from "@/lib/errors";
import { treasuryKind } from "@/lib/treasury";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/payments/[id] — confirme un paiement en attente (« pending » →
 * « effective »). C'est ici que les effets comptables s'appliquent enfin :
 * solde de la facture, écriture, trésorerie. Un paiement déjà effectif ne se
 * re-confirme pas.
 */
export const PATCH = withAuth("payments", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const payment = await PaymentModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!payment) return notFound("Paiement introuvable");

  // Seule transition supportée : encaisser un paiement en attente.
  if (body.status && body.status !== "effective") return badRequest("Transition de statut non supportée.");
  // Seul un paiement EN ATTENTE se confirme : un paiement annulé (chèque
  // impayé) reconfirmé était comptabilisé une seconde fois.
  if (payment.status !== "pending") return badRequest(payment.status === "effective" ? "Ce paiement est déjà encaissé." : "Paiement annulé : enregistrez un nouvel encaissement.");

  const invoice = await InvoiceModel.findOne({ _id: payment.invoiceId, ...tenantFilter(auth) });
  if (!invoice) return notFound("Facture introuvable");
  if (invoice.documentType === "credit_note") return badRequest("Un avoir ne s'encaisse pas : il se rembourse.");
  if (["paid", "cancelled", "written_off"].includes(invoice.status)) {
    return badRequest(`Cette facture est déjà ${invoice.status === "paid" ? "soldée" : invoice.status === "cancelled" ? "annulée" : "passée en perte"}.`);
  }
  const remaining = invoiceDue(invoice);
  if (payment.amount + (payment.withholdingAmount || 0) + (payment.exchangeDifference || 0) > remaining + 1) return badRequest(`Montant supérieur au reste à payer (${remaining} FCFA).`);
  // À l'encaissement : date réelle (saisie, sinon la date prévue si elle est passée,
  // sinon aujourd'hui) et compte réellement crédité.
  payment.date = paymentDate(body.date ?? (payment.date && payment.date <= new Date() ? payment.date.toISOString() : undefined));
  if (body.treasuryAccountId) {
    if (!(await treasuryKind(auth.tenantId, String(body.treasuryAccountId)))) return badRequest("Compte de trésorerie introuvable.");
    payment.treasuryAccountId = body.treasuryAccountId;
  }
  if (!payment.treasuryAccountId) return badRequest("Choisissez le compte (banque, caisse, mobile money) qui a reçu l'argent.");

  await withTransaction(async (session) => {
    // Transition gardée : deux confirmations simultanées ne comptabilisent
    // qu'une fois (la seconde ne trouve plus le paiement « en attente »).
    const r = await PaymentModel.updateOne({ _id: payment._id, status: "pending" },
      { $set: { status: "effective", date: payment.date, treasuryAccountId: payment.treasuryAccountId } }, { session });
    if (r.modifiedCount !== 1) throw new BusinessRuleError("Ce paiement vient d'être traité.");
    await applyPaymentEffects(payment, invoice, auth, session);
  });

  await logAudit(auth, "PAYMENT", "payments", { resourceId: String(params.id), after: { status: "effective" } });
  return ok({ status: "effective" });
});

/** DELETE — supprime un paiement EN ATTENTE (aucun effet à annuler). Un paiement
 * encaissé n'est pas supprimable ici (il faudrait contre-passer compta + trésorerie). */
export const DELETE = withAuth("payments", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const payment = await PaymentModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!payment) return notFound("Paiement introuvable");
  if (payment.status === "effective") {
    return conflict("Un paiement encaissé ne peut être supprimé (il a impacté la comptabilité).");
  }
  await PaymentModel.deleteOne({ _id: params.id });
  await logAudit(auth, "DELETE", "payments", { resourceId: String(params.id) });
  return noContent();
});
