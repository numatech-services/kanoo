import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { PaymentModel } from "@/models/Payment";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { reverseEntry } from "@/lib/accounting-reversal";
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
  const invoice = await InvoiceModel.findOne({ _id: payment.invoiceId, ...tenantFilter(auth) });

  await withTransaction(async session => {
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
      invoice.paidAmount = Math.max(0, (invoice.paidAmount || 0) - payment.amount);
      invoice.status = invoice.paidAmount <= 0 ? (invoice.dueDate && new Date(invoice.dueDate) < new Date() ? "overdue" : "sent") : "partial";
      await invoice.save({ session });
    }
    payment.status = "cancelled";
    payment.set({ cancelledAt: new Date(), cancelReason: reason.slice(0, 300) });
    await payment.save({ session });
  });

  await logAudit(auth, "UPDATE", "payments", { resourceId: String(params.id), after: { status: "cancelled", reason } });
  return ok({ status: "cancelled" });
});
