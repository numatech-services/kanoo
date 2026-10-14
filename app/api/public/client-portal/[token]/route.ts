import { NextRequest, NextResponse } from "next/server";
import { InvoiceModel } from "@/models/Invoice";
import { DevisModel } from "@/models/Devis";
import { TenantModel } from "@/models/Tenant";
import { portalGate, onlinePaymentsConfigured } from "@/lib/client-portal-server";
import { invoiceDue, BOOKED_INVOICE_MATCH } from "@/lib/payments";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> | { token: string } };

/**
 * GET — documents du client désigné par le lien : factures émises (reste à
 * payer, échéance), avoirs, devis envoyés. Jamais les brouillons ni les
 * données internes (écritures, imputations, notes internes).
 */
export async function GET(req: NextRequest, ctx: Params) {
  const { token } = ctx.params instanceof Promise ? await ctx.params : ctx.params;
  const gate = await portalGate(req, token);
  if (!gate.ok) return gate.response;
  const { client } = gate;
  const now = new Date();

  const [tenant, docs, quotes] = await Promise.all([
    TenantModel.findById(client.tenantId).select("name logo phone email address branding.primaryColor branding.paymentInstructions onlinePaymentAccountId")
      .lean<{ name: string; logo?: string; phone?: string; email?: string; address?: string; branding?: { primaryColor?: string; paymentInstructions?: string }; onlinePaymentAccountId?: unknown } | null>(),
    InvoiceModel.find({ tenantId: client.tenantId, clientId: client._id, ...BOOKED_INVOICE_MATCH })
      .select("number documentType issueDate dueDate totalTTC paidAmount creditedAmount retentionAmount status originalInvoiceId")
      .sort({ issueDate: -1 }).limit(200)
      .lean<Array<{ _id: unknown; number: string; documentType?: string; issueDate: Date; dueDate: Date; totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status: string }>>(),
    DevisModel.find({ tenantId: client.tenantId, clientId: client._id, status: { $in: ["sent", "accepted", "rejected", "expired"] } })
      .select("number issueDate validUntil totalTTC status acceptedOnline")
      .sort({ issueDate: -1 }).limit(100)
      .lean<Array<{ _id: unknown; number: string; issueDate: Date; validUntil: Date; totalTTC: number; status: string; acceptedOnline?: { at: Date; name: string } }>>(),
  ]);
  const payable = onlinePaymentsConfigured() && Boolean(tenant?.onlinePaymentAccountId);

  const invoices = docs.filter(d => d.documentType !== "credit_note").map(d => {
    const due = invoiceDue({ totalTTC: d.totalTTC, paidAmount: d.paidAmount, creditedAmount: d.creditedAmount, retentionAmount: d.retentionAmount, status: d.status });
    return {
      _id: d._id, number: d.number, issueDate: d.issueDate, dueDate: d.dueDate, totalTTC: d.totalTTC, due,
      // Facture annulée par un avoir : affichée (son avoir figure plus bas), rien à régler.
      status: d.status === "cancelled" ? "credited" : due <= 0 ? "paid" : new Date(d.dueDate) < now ? "overdue" : d.status === "partial" ? "partial" : "sent",
      canPay: payable && due > 0 && d.status !== "cancelled",
    };
  });
  const creditNotes = docs.filter(d => d.documentType === "credit_note").map(d => ({ _id: d._id, number: d.number, issueDate: d.issueDate, totalTTC: d.totalTTC }));

  return NextResponse.json({
    success: true,
    data: {
      supplier: { name: tenant?.name, logo: tenant?.logo, phone: tenant?.phone, email: tenant?.email, address: tenant?.address,
        color: tenant?.branding?.primaryColor, paymentInstructions: tenant?.branding?.paymentInstructions },
      client: { name: client.name },
      totals: { due: invoices.reduce((t, i) => t + i.due, 0), overdue: invoices.filter(i => i.status === "overdue").reduce((t, i) => t + i.due, 0) },
      invoices, creditNotes,
      quotes: quotes.map(q => ({ ...q, canAccept: q.status === "sent" && new Date(q.validUntil) >= new Date(now.toDateString()) })),
      onlinePayment: payable,
    },
  }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
