import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, tenantFilter } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { TenantModel } from "@/models/Tenant";
import { generateQuotePdf, type QuoteForPdf, type TenantIdentity } from "@/lib/pdf-document";

interface RouteParams { params: Promise<{ id: string }> | { id: string }; }

/** GET /api/devis/:id/pdf — devis PDF à la marque de l'organisation, QR apposé. */
export async function GET(req: NextRequest, ctx: RouteParams) {
  try {
    const auth = getAuthContext(req);
    if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    await connectDB();
    const { id } = ctx.params instanceof Promise ? await ctx.params : ctx.params;

    const [devis, tenant] = await Promise.all([
      DevisModel.findOne({ _id: id, ...tenantFilter(auth) })
        .populate("clientId", "name nif address phone")
        .lean<QuoteForPdf | null>(),
      TenantModel.findById(auth.tenantId)
        .select("name logo branding nif rccm address phone email")
        .lean<TenantIdentity | null>(),
    ]);
    if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

    const buf = await generateQuotePdf(devis, tenant ?? { name: "Organisation" });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${devis.number || "devis"}.pdf"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Erreur PDF devis :", error);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }
}
