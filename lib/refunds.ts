import type { ClientSession } from "mongoose";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { treasuryLedger } from "@/lib/treasury";
import { BusinessRuleError } from "@/lib/errors";

/**
 * Remboursement d'un avoir au client.
 *
 * Un avoir émis sur une facture déjà réglée laisse au client un crédit (411
 * créditeur) : l'argent lui revient, mais rien ne permettait de le lui rendre
 * en gardant comptabilité et trésorerie d'accord. Le remboursement débite le
 * client et crédite le compte qui paie, avec le mouvement de trésorerie.
 *
 * Remboursable = le plus petit de : ce qui reste de l'avoir, et le trop-perçu
 * réel sur la facture d'origine (réglé − déjà rendu − dû après avoirs).
 */

import { PaymentModel } from "@/models/Payment";

type CreditNote = {
  _id: unknown; number: string; documentType?: string; status: string; clientId: unknown; totalTTC: number;
  originalInvoiceId?: unknown; refundedAmount?: number;
};

export async function refundableFor(tenantId: string, cn: CreditNote, session?: ClientSession): Promise<number> {
  if (cn.documentType !== "credit_note" || cn.status === "cancelled" || !cn.originalInvoiceId) return 0;
  const orig = await InvoiceModel.findOne({ _id: cn.originalInvoiceId, tenantId }).session(session ?? null)
    .select("totalTTC paidAmount creditedAmount refundedAmount")
    .lean<{ totalTTC: number; paidAmount?: number; creditedAmount?: number; refundedAmount?: number } | null>();
  if (!orig) return 0;
  // Une pénalité retenue compte dans le payé sans avoir été encaissée : elle ne se rembourse pas.
  const penalties = await PaymentModel.find({ tenantId, invoiceId: cn.originalInvoiceId, status: "effective", penaltyAmount: { $gt: 0 } }).select("penaltyAmount").session(session ?? null).lean<Array<{ penaltyAmount: number }>>();
  const overpaid = (orig.paidAmount ?? 0) - penalties.reduce((t, p) => t + p.penaltyAmount, 0) - (orig.refundedAmount ?? 0) - (orig.totalTTC - (orig.creditedAmount ?? 0));
  return Math.max(0, Math.round(Math.min(cn.totalTTC - (cn.refundedAmount ?? 0), overpaid)));
}

export async function refundCreditNote(
  actor: { tenantId: string; userId: string },
  creditNoteId: unknown,
  input: { amount?: unknown; date?: unknown; treasuryAccountId?: unknown; reference?: unknown },
  session?: ClientSession,
) {
  const cn = await InvoiceModel.findOne({ _id: creditNoteId, tenantId: actor.tenantId }).session(session ?? null);
  if (!cn || cn.documentType !== "credit_note") throw new BusinessRuleError("Seul un avoir se rembourse.");
  const refundable = await refundableFor(actor.tenantId, cn, session);
  if (refundable <= 0) throw new BusinessRuleError("Rien à rembourser : la facture d'origine n'a pas été payée au-delà de ce qu'elle doit encore.");
  const amount = input.amount === undefined || input.amount === "" ? refundable : Math.round(Number(input.amount));
  if (!(amount > 0)) throw new BusinessRuleError("Montant du remboursement invalide.");
  if (amount > refundable) throw new BusinessRuleError(`Le remboursement dépasse le montant remboursable (${refundable.toLocaleString("fr-FR")} FCFA).`);
  const ledger = await treasuryLedger(actor.tenantId, input.treasuryAccountId, session);
  if (!ledger) throw new BusinessRuleError("Choisissez le compte (banque, caisse, mobile money) qui rembourse.");
  const date = input.date ? new Date(String(input.date)) : new Date();
  if (isNaN(date.getTime())) throw new BusinessRuleError("Date invalide.");
  const reference = input.reference ? String(input.reference).slice(0, 80) : `${cn.number}-RMB`;

  const [entry] = await AccountingEntryModel.create([{
    tenantId: actor.tenantId, journalCode: ledger.journalCode, entryDate: date, reference,
    label: `Remboursement de l'avoir ${cn.number}`,
    lines: [
      { accountCode: "411000", accountLabel: "Clients", debit: amount, credit: 0, thirdPartyId: cn.clientId },
      { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: 0, credit: amount },
    ],
    linkedDocType: "credit_note", linkedDocId: cn._id, createdBy: actor.userId,
  }], { session });
  const [movement] = await TreasuryMovementModel.create([{
    tenantId: actor.tenantId, accountId: input.treasuryAccountId, date, amount: -amount,
    label: `Remboursement de l'avoir ${cn.number}`, reference, source: "payment",
    linkedDocType: "invoice", linkedDocId: cn._id, createdBy: actor.userId,
  }], { session });

  cn.refundedAmount = (cn.refundedAmount ?? 0) + amount;
  cn.refunds.push({ date, amount, treasuryAccountId: input.treasuryAccountId, reference, entryId: entry._id, movementId: movement._id });
  await cn.save({ session });
  await InvoiceModel.updateOne({ _id: cn.originalInvoiceId, tenantId: actor.tenantId }, { $inc: { refundedAmount: amount } }, { session });
  return { amount, refundable: refundable - amount };
}
