import { adjustProvision } from "@/lib/doubtful-server";
import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PaymentModel } from "@/models/Payment";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { reverseEntry } from "@/lib/accounting-reversal";
import { statusAfterPaymentRemoved } from "@/lib/payments";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

/**
 * POST { reason } — annule un encaissement ENREGISTRÉ (chèque impayé, erreur
 * de facture) : écriture extournée, trésorerie recréditée à l'inverse, reste à
 * payer de la facture rouvert. Rien n'est effacé.
 */
export const POST = withAuth("payments", "delete", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim();
  if (!reason) return badRequest("Indiquez le motif de l'annulation.");
  const payment = await PaymentModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!payment) return notFound("Paiement introuvable");
  if (payment.status !== "effective") return badRequest(payment.status === "cancelled" ? "Paiement déjà annulé." : "Paiement en attente : supprimez-le simplement.");
  await withTransaction(async session => {
    // Transition gardée (double clic) et facture relue dans la transaction.
    const r = await PaymentModel.updateOne({ _id: payment._id, status: "effective" },
      { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason.slice(0, 300) } }, { session });
    if (r.modifiedCount !== 1) throw new BusinessRuleError("Paiement déjà annulé.");
    const invoice = await InvoiceModel.findOne({ _id: payment.invoiceId, ...tenantFilter(auth) }).session(session ?? null);
    const entry = await AccountingEntryModel.findOne({ tenantId: auth.tenantId, linkedDocType: "payment", linkedDocId: payment._id, reversedBy: { $exists: false } }).session(session ?? null);
    if (entry) await reverseEntry({ tenantId: auth.tenantId, userId: auth.userId, entryId: entry._id, reason: `encaissement annulé : ${reason}` }, session);
    const moves = await TreasuryMovementModel.find({ tenantId: auth.tenantId, linkedDocType: "payment", linkedDocId: payment._id }).session(session ?? null);
    for (const m of moves) {
      await TreasuryMovementModel.create([{
        tenantId: auth.tenantId, accountId: m.accountId, date: new Date(), amount: -m.amount,
        label: `Annulation — ${m.label}`, source: "payment", linkedDocType: "payment", linkedDocId: payment._id, createdBy: auth.userId,
      }], { session });
    }
    if (invoice) {
      const withheld = payment.withholdingAmount || 0;
      const fx = payment.exchangeDifference || 0;
      invoice.paidAmount = Math.max(0, (invoice.paidAmount || 0) - payment.amount - withheld - fx);
      if (withheld) invoice.retenueSource = Math.max(0, (invoice.retenueSource || 0) - withheld);
      // Une facture annulée par avoir ou passée en perte garde son statut.
      invoice.status = statusAfterPaymentRemoved(invoice);
      await invoice.save({ session });
      // Créance douteuse : le reste dû remonte, sa dépréciation aussi.
      if (invoice.doubtfulAt) await adjustProvision({ tenantId: auth.tenantId, userId: auth.userId }, invoice, invoice.provisionRate ?? 0, new Date(), session);
    }
  });

  await logAudit(auth, "UPDATE", "payments", { resourceId: String(params.id), after: { status: "cancelled", reason } });
  return ok({ status: "cancelled" });
});
