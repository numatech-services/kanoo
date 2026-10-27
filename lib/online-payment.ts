import type { ClientSession } from "mongoose";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { TenantModel } from "@/models/Tenant";
import { applyPaymentEffects, invoiceDue } from "@/lib/payments";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { treasuryLedger } from "@/lib/treasury";
import { DEPOSIT_ACCOUNT } from "@/lib/deposit";
import type { TokenPayload } from "@/lib/auth";

/**
 * Paiement en ligne confirmé (PayDunya, mobile money ou carte) : enregistré
 * comme un encaissement ordinaire sur le compte « paiements en ligne » de
 * l'organisation — écriture, mouvement de trésorerie, facture soldée ou
 * partielle —, sans saisie. La référence PayDunya rend l'opération idempotente :
 * un webhook rejoué n'encaisse pas deux fois.
 */
export async function recordOnlineInvoicePayment(
  input: { invoiceId: string; amount: number; reference: string },
  session?: ClientSession,
): Promise<{ recorded: boolean; reason?: string; amount?: number }> {
  if (await PaymentModel.exists({ reference: input.reference }).session(session ?? null)) return { recorded: false, reason: "déjà enregistré" };
  const invoice = await InvoiceModel.findById(input.invoiceId).session(session ?? null);
  if (!invoice || invoice.documentType === "credit_note" || ["draft"].includes(invoice.status)) return { recorded: false, reason: "facture introuvable ou non payable" };
  const tenant = await TenantModel.findById(invoice.tenantId).select("onlinePaymentAccountId").session(session ?? null)
    .lean<{ onlinePaymentAccountId?: unknown } | null>();
  if (!tenant?.onlinePaymentAccountId) return { recorded: false, reason: "compte des paiements en ligne non paramétré" };
  const received = Math.round(input.amount);
  if (!(received > 0)) return { recorded: false, reason: "rien à encaisser" };
  // Facture déjà soldée, annulée ou passée en perte : tout le montant reçu est un trop-perçu.
  const due = ["paid", "cancelled", "written_off"].includes(invoice.status) ? 0 : invoiceDue(invoice);
  const amount = Math.min(received, due);
  // Reçu au-delà du reste dû (facture réglée entre-temps par un autre moyen,
  // double paiement) : l'argent est bien arrivé chez PayDunya. Il était ignoré
  // — compte « paiements en ligne » impossible à rapprocher. Il devient une
  // avance du client (419), à rembourser ou à imputer sur une prochaine facture.
  const excess = received - amount;

  const actor = { tenantId: String(invoice.tenantId), userId: String(invoice.createdBy) } as TokenPayload;
  const base = {
    tenantId: invoice.tenantId, invoiceId: invoice._id, method: "mobile_money", status: "effective",
    date: new Date(), treasuryAccountId: tenant.onlinePaymentAccountId, createdBy: invoice.createdBy,
  };
  if (amount > 0) {
    const [payment] = await PaymentModel.create([{ ...base, amount, reference: input.reference, notes: "Paiement en ligne (portail client)" }], { session });
    await applyPaymentEffects(payment, invoice, actor, session);
  }
  if (excess > 0) {
    const ledger = await treasuryLedger(String(invoice.tenantId), tenant.onlinePaymentAccountId, session);
    if (ledger) {
      const label = `Trop-perçu en ligne — facture ${invoice.number}`;
      await AccountingEntryModel.create([{
        tenantId: invoice.tenantId, journalCode: ledger.journalCode, entryDate: new Date(),
        reference: `${input.reference}-EXC`.slice(0, 60), label,
        lines: [
          { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: excess, credit: 0 },
          { ...DEPOSIT_ACCOUNT, debit: 0, credit: excess, thirdPartyId: invoice.clientId },
        ],
        linkedDocType: "invoice", linkedDocId: invoice._id, createdBy: invoice.createdBy,
      }], { session });
      await TreasuryMovementModel.create([{
        tenantId: invoice.tenantId, accountId: tenant.onlinePaymentAccountId, date: new Date(), amount: excess,
        label, reference: input.reference, source: "payment", linkedDocType: "invoice", linkedDocId: invoice._id, createdBy: invoice.createdBy,
      }], { session });
    }
  }
  return { recorded: true, amount, ...(excess > 0 ? { reason: `trop-perçu de ${excess} FCFA porté en avance client` } : {}) };
}
