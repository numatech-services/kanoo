import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { TokenPayload } from "@/lib/auth";

/**
 * Applique les effets comptables d'un encaissement EFFECTIF : solde de la
 * facture, écriture comptable (BQ/CA), et mouvement de trésorerie si un compte
 * est désigné. Réutilisé à la création (paiement effectif) et à la confirmation
 * d'un paiement en attente. Un paiement « pending » n'appelle jamais ceci.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function applyPaymentEffects(payment: any, invoice: any, auth: TokenPayload, session: any) {
  const amount = payment.amount;
  invoice.paidAmount += amount;
  invoice.status = invoice.paidAmount >= invoice.totalTTC - 1 ? "paid" : "partial";
  await invoice.save({ session });

  const journalCode = payment.method === "cash" ? "CA" : "BQ";
  const bankAccount = payment.method === "cash" ? "571000" : "521000";
  await AccountingEntryModel.create([{
    tenantId: auth.tenantId, journalCode, entryDate: new Date(payment.date),
    reference: `PMNT-${payment._id.toString().slice(-6).toUpperCase()}`,
    label: `Règlement facture ${invoice.number}`,
    lines: [
      { accountCode: bankAccount, accountLabel: payment.method === "cash" ? "Caisse" : "Banque", debit: amount, credit: 0 },
      { accountCode: "411000", accountLabel: "Clients", debit: 0, credit: amount, thirdPartyId: invoice.clientId },
    ],
    linkedDocType: "payment", linkedDocId: payment._id, createdBy: auth.userId,
  }], { session });

  if (payment.treasuryAccountId) {
    await TreasuryMovementModel.create([{
      tenantId: auth.tenantId, accountId: payment.treasuryAccountId, date: new Date(payment.date),
      amount, label: `Règlement facture ${invoice.number}`, reference: payment.reference,
      source: "payment", linkedDocType: "payment", linkedDocId: payment._id, createdBy: auth.userId,
    }], { session });
  }
}
