import type { ClientSession } from "mongoose";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { TenantModel } from "@/models/Tenant";
import { applyPaymentEffects, invoiceDue } from "@/lib/payments";
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
  if (!invoice || invoice.documentType === "credit_note" || ["draft", "cancelled"].includes(invoice.status)) return { recorded: false, reason: "facture introuvable ou non payable" };
  const tenant = await TenantModel.findById(invoice.tenantId).select("onlinePaymentAccountId").session(session ?? null)
    .lean<{ onlinePaymentAccountId?: unknown } | null>();
  if (!tenant?.onlinePaymentAccountId) return { recorded: false, reason: "compte des paiements en ligne non paramétré" };
  const due = invoiceDue(invoice);
  const amount = Math.min(Math.round(input.amount), due);
  if (!(amount > 0)) return { recorded: false, reason: "rien à encaisser" };

  const actor = { tenantId: String(invoice.tenantId), userId: String(invoice.createdBy) } as TokenPayload;
  const [payment] = await PaymentModel.create([{
    tenantId: invoice.tenantId, invoiceId: invoice._id, amount, method: "mobile_money", status: "effective",
    date: new Date(), reference: input.reference, treasuryAccountId: tenant.onlinePaymentAccountId,
    notes: "Paiement en ligne (portail client)", createdBy: invoice.createdBy,
  }], { session });
  await applyPaymentEffects(payment, invoice, actor, session);
  return { recorded: true, amount };
}
