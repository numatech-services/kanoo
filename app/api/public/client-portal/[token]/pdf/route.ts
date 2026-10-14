import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { InvoiceModel } from "@/models/Invoice";
import { DevisModel } from "@/models/Devis";
import { TenantModel } from "@/models/Tenant";
import { portalGate } from "@/lib/client-portal-server";
import { BOOKED_INVOICE_MATCH } from "@/lib/payments";
import { generateInvoicePdf, generateQuotePdf, type InvoiceForPdf, type QuoteForPdf, type TenantIdentity } from "@/lib/pdf-document";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ token: string }> | { token: string } };

/** GET ?kind=invoice|quote&id= — PDF d'un document du client (et de lui seul). */
export async function GET(req: NextRequest, ctx: Params) {
  const { token } = ctx.params instanceof Promise ? await ctx.params : ctx.params;
  const gate = await portalGate(req, token);
  if (!gate.ok) return gate.response;
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const kind = url.searchParams.get("kind") === "quote" ? "quote" : "invoice";
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Document introuvable." }, { status: 404 });
  const scope = { _id: id, tenantId: gate.client.tenantId, clientId: gate.client._id };
  const tenant = await TenantModel.findById(gate.client.tenantId).select("name logo branding nif rccm address phone email").lean<TenantIdentity | null>();

  let pdf: Buffer, name: string;
  if (kind === "quote") {
    const q = await DevisModel.findOne({ ...scope, status: { $ne: "draft" } }).populate("clientId", "name nif rccm code address phone").lean<QuoteForPdf & { number?: string } | null>();
    if (!q) return NextResponse.json({ success: false, error: "Document introuvable." }, { status: 404 });
    pdf = await generateQuotePdf(q, tenant ?? { name: "Organisation" }); name = q.number ?? "devis";
  } else {
    const inv = await InvoiceModel.findOne({ ...scope, ...BOOKED_INVOICE_MATCH }).populate("clientId", "name nif rccm code address phone").lean<InvoiceForPdf & { number?: string } | null>();
    if (!inv) return NextResponse.json({ success: false, error: "Document introuvable." }, { status: 404 });
    pdf = await generateInvoicePdf(inv, tenant ?? { name: "Organisation" }); name = inv.number ?? "facture";
  }
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
