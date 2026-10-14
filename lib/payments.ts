import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { TokenPayload } from "@/lib/auth";
import { ledgerFor, treasuryLedger, registerLedgerAccount } from "@/lib/treasury";

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
export function invoiceDue(inv: { totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status?: string }): number {
  // Retenue de garantie : due plus tard (réception définitive), pas exigible maintenant.
  // Une facture annulée par avoir total ne la retient plus.
  const retention = inv.status === "cancelled" ? 0 : (inv.retentionAmount || 0);
  return Math.max(0, Math.round(inv.totalTTC - (inv.creditedAmount || 0) - (inv.paidAmount || 0) - retention));
}

/** Même calcul en expression d'agrégation MongoDB (reste exigible d'une facture). */
export const INVOICE_DUE_EXPR = {
  $subtract: ["$totalTTC", { $add: [{ $ifNull: ["$paidAmount", 0] }, { $ifNull: ["$creditedAmount", 0] }, { $ifNull: ["$retentionAmount", 0] }] }],
};

/** Retenues à la source subies sur les encaissements : acomptes d'impôt sur l'État. */
export const WITHHOLDING_SUFFERED = { accountCode: "449200", accountLabel: "État — retenues à la source subies" };

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function applyPaymentEffects(payment: any, invoice: any, auth: TokenPayload, session: any) {
  const amount = payment.amount;
  // Retenue subie : le client a payé le net ; la facture est soldée du brut, la
  // retenue devient une créance sur l'État (4492), imputable sur l'IS/BIC.
  const withheld = Math.round(payment.withholdingAmount || 0);
  // Un règlement reçu sur un brouillon vaut émission : la facture est
  // comptabilisée avant que son règlement ne solde le compte client.
  if (invoice.status === "draft") await issueInvoice({ tenantId: auth.tenantId, userId: auth.userId }, invoice, session);
  invoice.paidAmount += amount + withheld;
  if (withheld > 0) invoice.retenueSource = (invoice.retenueSource || 0) + withheld;
  invoice.status = invoiceDue(invoice) <= 1 ? "paid" : "partial";
  await invoice.save({ session });

  // Le compte encaisseur fait foi (caisse, banque, mobile money) ; à défaut, le
  // mode de règlement.
  const ledger = (await treasuryLedger(auth.tenantId, payment.treasuryAccountId, session))
    ?? ledgerFor(payment.method === "cash" ? "cash" : payment.method === "mobile_money" ? "mobile_money" : "bank");
  const journalCode = ledger.journalCode;
  // Organisations créées avant l'arrivée du 449200 : le compte rejoint leur plan.
  if (withheld > 0) await registerLedgerAccount(auth.tenantId, WITHHOLDING_SUFFERED.accountCode, "État — retenues à la source subies (acomptes d'impôt)", session);
  await AccountingEntryModel.create([{
    tenantId: auth.tenantId, journalCode, entryDate: new Date(payment.date),
    reference: `PMNT-${payment._id.toString().slice(-6).toUpperCase()}`,
    label: `Règlement facture ${invoice.number}`,
    lines: [
      { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: amount, credit: 0 },
      ...(withheld > 0 ? [{ ...WITHHOLDING_SUFFERED, debit: withheld, credit: 0, thirdPartyId: invoice.clientId }] : []),
      { accountCode: "411000", accountLabel: "Clients", debit: 0, credit: amount + withheld, thirdPartyId: invoice.clientId },
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

/**
 * Factures qui comptent dans les ventes d'une période, avoirs à retrancher.
 *
 * Un avoir total fait passer la facture d'origine au statut « annulée » : elle
 * doit rester dans les ventes, que son avoir compense. L'exclure tout en
 * retranchant l'avoir déduisait deux fois la même vente (chiffre d'affaires
 * négatif, base de TVA sous-évaluée). Seuls les brouillons, et les brouillons
 * supprimés (annulés sans avoir), sont écartés.
 */
export const BOOKED_INVOICE_MATCH = {
  $or: [{ status: { $nin: ["cancelled", "draft"] } }, { status: "cancelled", creditedAmount: { $gt: 0 } }],
};
