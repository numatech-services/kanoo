import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter, requireFields } from "@/lib/api-helpers";
import { isId, ownDesk, parsePack } from "@/lib/comptoir";
import { ActivityItemModel } from "@/models/ActivityItem";
import { logAudit } from "@/lib/audit";
import { ProductModel } from "@/models/Product";
import { deskWarehouse, syncLinkedItems } from "@/lib/comptoir-stock";
import { TokenPayload } from "@/lib/auth";
import { canSeeDeskCosts } from "@/lib/comptoir";

export const dynamic = "force-dynamic";

// Articles d'un comptoir (comptabilité matière). `deskId` requis pour cadrer.
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  await syncLinkedItems(auth.tenantId, deskId);
  const items = await ActivityItemModel.find({ ...tenantFilter(auth), deskId, archived: { $ne: true } })
    .populate("productId", "code label trackingMode").sort({ name: 1 }).lean<Array<Record<string, unknown>>>();
  // Coût d'achat et valeur du stock : gérant et comptabilité seulement.
  return ok(canSeeDeskCosts(auth) ? items : items.map(i => ({ ...i, unitCost: null })));
});

export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, body.productId ? ["deskId"] : ["deskId", "name"]);
  if (err) return badRequest(err);
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  // Article du catalogue : son stock vit dans la réserve du comptoir (quantité
  // jamais saisie ici — elle arrive par approvisionnement ou achat).
  type CatalogProduct = { _id: unknown; label: string; unit?: string; unitPrice?: number; purchaseCost?: number; code: string };
  let product: CatalogProduct | null = null;
  if (body.productId) {
    if (!isId(body.productId)) return badRequest("Article du catalogue invalide.");
    product = await ProductModel.findOne({ _id: body.productId, ...tenantFilter(auth), isService: { $ne: true } })
      .select("label unit unitPrice purchaseCost code").lean<CatalogProduct | null>();
    if (!product) return badRequest("Article du catalogue introuvable (ou service).");
    if (await ActivityItemModel.exists({ ...tenantFilter(auth), deskId: body.deskId, productId: product._id, archived: { $ne: true } })) {
      return badRequest("Cet article du catalogue est déjà au comptoir.");
    }
    await deskWarehouse(auth.tenantId, body.deskId);
  }
  const pack = "pack" in body ? parsePack(body.pack) : null;
  if (pack === "invalid") return badRequest("Conditionnement invalide (nombre d'unités par paquet, prix du paquet).");
  const item = await ActivityItemModel.create({
    tenantId: auth.tenantId,
    deskId: body.deskId,
    name: String(body.name || product?.label || "").slice(0, 160).trim(),
    unit: String(body.unit || product?.unit || "unité").slice(0, 24),
    sku: String(body.sku || product?.code || "").slice(0, 60) || undefined,
    productId: product?._id,
    quantity: product ? 0 : Math.max(0, Number(body.quantity) || 0),
    // Article propre acheté par paquet : coût unitaire = prix du paquet ÷ unités.
    unitCost: product ? product.purchaseCost ?? 0 : Math.max(0, Number(body.unitCost) || 0) || (pack?.cost && pack.size ? Math.round((pack.cost / pack.size) * 100) / 100 : 0),
    ...(pack ? { pack } : {}),
    ...(body.category ? { category: String(body.category).trim().slice(0, 60) } : {}),
    salePrice: body.salePrice != null ? Math.max(0, Number(body.salePrice)) : undefined,
    threshold: body.threshold != null ? Math.max(0, Number(body.threshold)) : undefined,
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "comptoir", { resourceId: item._id.toString(), metadata: { item: item.name } });
  return created(item);
});
