import { NextRequest, NextResponse } from "next/server";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { connectDB } from "@/lib/db";
import { authorize, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { TenantModel } from "@/models/Tenant";
import { generateInvoicePdf, type InvoiceForPdf, type TenantIdentity } from "@/lib/pdf-document";
import { currentPortalLink } from "@/lib/client-portal";

interface RouteParams { params: Promise<{ id: string }> | { id: string }; }

/**
 * GET /api/invoices/:id/pdf — facture PDF à la marque de l'organisation.
 *
 * L'ancienne version dessinait un PDF générique (fond noir, « généré par
 * Kanoo »), sans logo, couleurs ni identité du tenant, et sans QR. Elle délègue
 * désormais à `generateInvoicePdf`, qui lit `tenant.branding` et appose un QR
 * de vérification (SECeF si la facture est certifiée).
 */
export async function GET(req: NextRequest, ctx: RouteParams) {
  try {
    const gate = await authorize(req, "invoices", "read");
    if (!gate.ok) return gate.response;
    const auth = gate.auth;
    // Stagiaire : ni export ni envoi de fichier (règle commune).
    if (isInternFor(auth, "invoices")) return NextResponse.json({ success: false, error: INTERN_EXPORT_MESSAGE }, { status: 403 });

    await connectDB();
    const { id } = ctx.params instanceof Promise ? await ctx.params : ctx.params;

    const [invoice, tenant] = await Promise.all([
      InvoiceModel.findOne({ _id: id, ...tenantFilter(auth) })
        .populate("clientId", "name nif rccm code address phone")
        .lean<InvoiceForPdf | null>(),
      TenantModel.findById(auth.tenantId)
        .select("name logo branding nif rccm address phone email")
        .lean<TenantIdentity | null>(),
    ]);

    if (!invoice) {
      return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });
    }

    // Client doté d'un lien de portail : QR « consulter et payer en ligne » sur la facture.
    const clientRef = (invoice as unknown as { clientId?: { _id?: unknown } | unknown }).clientId;
    const portalUrl = await currentPortalLink(auth.tenantId, (clientRef as { _id?: unknown })?._id ?? clientRef);
    const pdfBuffer = await generateInvoicePdf(invoice, tenant ?? { name: "Organisation" }, { portalUrl });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.number || "facture"}.pdf"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Erreur serveur PDF :", error);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }
}
