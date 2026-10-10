import { NextRequest, NextResponse } from "next/server";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { connectDB } from "@/lib/db";
import { authorize, tenantFilter } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { TenantModel } from "@/models/Tenant";
import { generateQuotePdf, type QuoteForPdf, type TenantIdentity } from "@/lib/pdf-document";

interface RouteParams { params: Promise<{ id: string }> | { id: string }; }

/** GET /api/devis/:id/pdf — devis PDF à la marque de l'organisation, QR apposé. */
export async function GET(req: NextRequest, ctx: RouteParams) {
  try {
    const gate = await authorize(req, "devis", "read");
    if (!gate.ok) return gate.response;
    const auth = gate.auth;
    // Stagiaire : ni export ni envoi de fichier (règle commune).
    if (isInternFor(auth, "devis")) return NextResponse.json({ success: false, error: INTERN_EXPORT_MESSAGE }, { status: 403 });

    await connectDB();
    const { id } = ctx.params instanceof Promise ? await ctx.params : ctx.params;

    const [devis, tenant] = await Promise.all([
      DevisModel.findOne({ _id: id, ...tenantFilter(auth) })
        .populate("clientId", "name nif rccm code address phone")
        .lean<QuoteForPdf | null>(),
      TenantModel.findById(auth.tenantId)
        .select("name logo branding nif rccm address phone email")
        .lean<TenantIdentity | null>(),
    ]);
    if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

    const proforma = new URL(req.url).searchParams.get("proforma") === "1";
    const buf = await generateQuotePdf(devis, tenant ?? { name: "Organisation" }, { proforma });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${proforma ? "proforma-" : ""}${devis.number || "devis"}.pdf"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Erreur PDF devis :", error);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }
}
