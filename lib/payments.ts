import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { TokenPayload } from "@/lib/auth";
import { ledgerFor, treasuryLedger } from "@/lib/treasury";

import { issueInvoice } from "@/lib/invoice-posting";
/**
 * Applique les effets comptables d'un encaissement EFFECTIF : solde de la
 * facture, écriture comptable (BQ/CA), et mouvement de trésorerie si un compte
 * est désigné. Réutilisé à la création (paiement effectif) et à la confirmation
 * d'un paiement en attente. Un paiement « pending » n'appelle jamais ceci.
 */
/**
 * Reste à payer d'une facture : TTC, moins les avoirs déjà émis, moins les
 * règlements. Sans les avoirs, un client pouvait payer ce qui lui avait été crédité.
 */
export function invoiceDue(inv: { totalTTC: number; paidAmount?: number; creditedAmount?: number }): number {
  return Math.max(0, Math.round(inv.totalTTC - (inv.creditedAmount || 0) - (inv.paidAmount || 0)));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function applyPaymentEffects(payment: any, invoice: any, auth: TokenPayload, session: any) {
  const amount = payment.amount;
  // Un règlement reçu sur un brouillon vaut émission : la facture est
  // comptabilisée avant que son règlement ne solde le compte client.
  if (invoice.status === "draft") await issueInvoice({ tenantId: auth.tenantId, userId: auth.userId }, invoice, session);
  invoice.paidAmount += amount;
  invoice.status = invoiceDue(invoice) <= 1 ? "paid" : "partial";
  await invoice.save({ session });

  // Le compte encaisseur fait foi (caisse, banque, mobile money) ; à défaut, le
  // mode de règlement.
  const ledger = (await treasuryLedger(auth.tenantId, payment.treasuryAccountId, session))
    ?? ledgerFor(payment.method === "cash" ? "cash" : payment.method === "mobile_money" ? "mobile_money" : "bank");
  const journalCode = ledger.journalCode;
  await AccountingEntryModel.create([{
    tenantId: auth.tenantId, journalCode, entryDate: new Date(payment.date),
    reference: `PMNT-${payment._id.toString().slice(-6).toUpperCase()}`,
    label: `Règlement facture ${invoice.number}`,
    lines: [
      { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: amount, credit: 0 },
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
