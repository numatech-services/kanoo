import { NextRequest, NextResponse } from "next/server";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { connectDB } from "@/lib/db";
import { authorize, tenantFilter } from "@/lib/api-helpers";
import { CommandeModel } from "@/models/Commande";
import { TenantModel } from "@/models/Tenant";
import { renderBusinessPdf, isDocStyle, type DocTenant } from "@/lib/pdf-business";
import { orderDoc, type OrderLike } from "@/lib/business-doc";

interface RouteParams { params: Promise<{ id: string }> | { id: string }; }

/** GET /api/commandes/:id/pdf — bon de commande au fournisseur, prêt à l'envoi (accusé de réception). */
export async function GET(req: NextRequest, ctx: RouteParams) {
  try {
    const gate = await authorize(req, "commandes", "read");
    if (!gate.ok) return gate.response;
    const auth = gate.auth;
    if (isInternFor(auth, "commandes")) return NextResponse.json({ success: false, error: INTERN_EXPORT_MESSAGE }, { status: 403 });
    await connectDB();
    const { id } = ctx.params instanceof Promise ? await ctx.params : ctx.params;
    const [order, tenant] = await Promise.all([
      CommandeModel.findOne({ _id: id, ...tenantFilter(auth) })
        .populate("supplierId", "name nif rccm code address phone")
        .lean<OrderLike & { number?: string } | null>(),
      TenantModel.findById(auth.tenantId).select("name logo branding nif rccm address phone email").lean<DocTenant | null>(),
    ]);
    if (!order) return NextResponse.json({ error: "Bon de commande introuvable" }, { status: 404 });
    const st = new URL(req.url).searchParams.get("style");
    const buf = await renderBusinessPdf(orderDoc(order, tenant ?? { name: "Organisation" }), tenant ?? { name: "Organisation" }, { style: isDocStyle(st) ? st : undefined });
    return new NextResponse(new Uint8Array(buf), { status: 200, headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${order.number || "bon-de-commande"}.pdf"`, "Cache-Control": "no-store, max-age=0",
    } });
  } catch (error) {
    console.error("Erreur PDF bon de commande :", error);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }
}
