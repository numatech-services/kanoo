import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, tenantFilter } from "@/lib/api-helpers";
import { LetterModel } from "@/models/Letter";
import { TenantModel } from "@/models/Tenant";
import { generateLetterPdf, type LetterForPdf, type TenantIdentity } from "@/lib/pdf-document";

interface RouteParams { params: Promise<{ id: string }> | { id: string }; }

/** GET /api/courriers/:id/pdf — courrier PDF à la marque de l'organisation. */
export async function GET(req: NextRequest, ctx: RouteParams) {
  try {
    const auth = getAuthContext(req);
    if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    await connectDB();
    const { id } = ctx.params instanceof Promise ? await ctx.params : ctx.params;

    const [letter, tenant] = await Promise.all([
      LetterModel.findOne({ _id: id, ...tenantFilter(auth) }).lean<(LetterForPdf & { subject?: string }) | null>(),
      TenantModel.findById(auth.tenantId).select("name logo branding nif rccm address phone email").lean<TenantIdentity | null>(),
    ]);
    if (!letter) return NextResponse.json({ error: "Courrier introuvable" }, { status: 404 });

    const buf = await generateLetterPdf(letter, tenant ?? { name: "Organisation" });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${(letter.subject || "courrier").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}.pdf"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Erreur PDF courrier :", error);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }
}
