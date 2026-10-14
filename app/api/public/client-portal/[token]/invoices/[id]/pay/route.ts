import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { InvoiceModel } from "@/models/Invoice";
import { TenantModel } from "@/models/Tenant";
import { portalGate, onlinePaymentsConfigured } from "@/lib/client-portal-server";
import { createPaydunyaInvoice } from "@/lib/paydunya";
import { invoiceDue } from "@/lib/payments";
import { appBaseUrl } from "@/lib/app-url";

type Params = { params: Promise<{ token: string; id: string }> | { token: string; id: string } };

/**
 * POST — ouvre le paiement en ligne (mobile money, carte) du reste dû d'une
 * facture. La confirmation arrive par le webhook PayDunya, qui revérifie le
 * paiement auprès de PayDunya avant de l'enregistrer (lib/online-payment).
 */
export async function POST(req: NextRequest, ctx: Params) {
  const { token, id } = ctx.params instanceof Promise ? await ctx.params : ctx.params;
  const gate = await portalGate(req, token);
  if (!gate.ok) return gate.response;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Facture introuvable." }, { status: 404 });
  const tenant = await TenantModel.findById(gate.client.tenantId).select("name onlinePaymentAccountId").lean<{ name: string; onlinePaymentAccountId?: unknown } | null>();
  if (!onlinePaymentsConfigured() || !tenant?.onlinePaymentAccountId) {
    return NextResponse.json({ success: false, error: "Le paiement en ligne n'est pas activé par votre fournisseur." }, { status: 400 });
  }
  const inv = await InvoiceModel.findOne({ _id: id, tenantId: gate.client.tenantId, clientId: gate.client._id, documentType: { $ne: "credit_note" }, status: { $nin: ["draft", "cancelled"] } })
    .select("number totalTTC paidAmount creditedAmount retentionAmount status").lean<{ _id: unknown; number: string; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status?: string } | null>();
  if (!inv) return NextResponse.json({ success: false, error: "Facture introuvable." }, { status: 404 });
  const due = invoiceDue(inv);
  if (due <= 0) return NextResponse.json({ success: false, error: "Cette facture est déjà réglée." }, { status: 409 });

  const portal = `${appBaseUrl()}/client/${token}`;
  const r = await createPaydunyaInvoice({
    totalAmount: due,
    description: `Facture ${inv.number} — ${tenant.name}`,
    customerName: gate.client.name, customerEmail: gate.client.email ?? "", customerPhone: gate.client.phone,
    orderId: `INV-${String(inv._id)}-${Date.now()}`,
    returnUrl: `${portal}?paid=${inv.number}`, cancelUrl: portal,
    webhookUrl: `${appBaseUrl()}/api/webhooks/payment`,
  });
  if (!r.success || !r.paymentUrl) return NextResponse.json({ success: false, error: r.error || "Paiement en ligne indisponible pour le moment." }, { status: 502 });
  return NextResponse.json({ success: true, data: { paymentUrl: r.paymentUrl } });
}
