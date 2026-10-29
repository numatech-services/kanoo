import { NextRequest, NextResponse } from "next/server";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { connectDB } from "@/lib/db";
import { authorize, tenantFilter } from "@/lib/api-helpers";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { TenantModel } from "@/models/Tenant";
import { renderBusinessPdf, isDocStyle, type DocTenant } from "@/lib/pdf-business";
import { deliveryDoc, type DeliveryLike } from "@/lib/business-doc";

interface RouteParams { params: Promise<{ id: string }> | { id: string }; }

/** GET /api/livraisons/:id/pdf — bon de livraison prêt à faire signer (quantités commandées et livrées, « Reçu par »). */
export async function GET(req: NextRequest, ctx: RouteParams) {
  try {
    const gate = await authorize(req, "livraisons", "read");
    if (!gate.ok) return gate.response;
    const auth = gate.auth;
    if (isInternFor(auth, "livraisons")) return NextResponse.json({ success: false, error: INTERN_EXPORT_MESSAGE }, { status: 403 });
    await connectDB();
    const { id } = ctx.params instanceof Promise ? await ctx.params : ctx.params;
    const [note, tenant] = await Promise.all([
      DeliveryNoteModel.findOne({ _id: id, ...tenantFilter(auth) })
        .populate("clientId", "name nif rccm code address phone").populate("invoiceId", "number lines")
        .lean<DeliveryLike | null>(),
      TenantModel.findById(auth.tenantId).select("name logo branding nif rccm address phone email").lean<DocTenant | null>(),
    ]);
    if (!note) return NextResponse.json({ error: "Bon de livraison introuvable" }, { status: 404 });
    const st = new URL(req.url).searchParams.get("style");
    const buf = await renderBusinessPdf(deliveryDoc(note, tenant ?? { name: "Organisation" }), tenant ?? { name: "Organisation" }, { style: isDocStyle(st) ? st : undefined });
    return new NextResponse(new Uint8Array(buf), { status: 200, headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${note.number || "bon-de-livraison"}.pdf"`, "Cache-Control": "no-store, max-age=0",
    } });
  } catch (error) {
    console.error("Erreur PDF bon de livraison :", error);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }
}
