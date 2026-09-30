import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent, notFound, badRequest, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { isId, deskFilter } from "@/lib/comptoir";
import { ActivityItemModel } from "@/models/ActivityItem";
import { logAudit } from "@/lib/audit";
import { withTransaction } from "@/lib/db";
import { ProductModel } from "@/models/Product";
import { applyMovement, StockError } from "@/lib/stock";
import { deskWarehouse, syncLinkedItems } from "@/lib/comptoir-stock";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const PATCH = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Article introuvable");
  const body = await req.json().catch(() => ({}));
  const clean = sanitizeBody(body);
  // La quantité n'est jamais fixée à la main : elle ne bouge que par un mouvement
  // de stock (traçabilité). On n'autorise donc pas `quantity` ici.
  const update: Record<string, unknown> = {};
  if ("name" in clean) update.name = String(clean.name || "").slice(0, 160).trim();
  if ("unit" in clean) update.unit = String(clean.unit || "unité").slice(0, 24);
  if ("sku" in clean) update.sku = String(clean.sku || "").slice(0, 60);
  if ("archived" in clean) update.archived = Boolean(clean.archived);
  for (const f of ["unitCost", "salePrice", "threshold"]) {
    if (f in clean) {
      const n = Number(clean[f]);
      if (!Number.isFinite(n) || n < 0) return badRequest(`Valeur invalide : ${f}`);
      update[f] = n;
    }
  }
  if (update.name === "") return badRequest("Le nom est requis.");

  // Rattachement au catalogue : le stock propre du comptoir entre dans sa
  // réserve (reprise tracée) ; détachement : la quantité est figée.
  if ("productId" in clean) {
    const cur = await ActivityItemModel.findOne({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) });
    if (!cur) return notFound("Article introuvable");
    if (clean.productId && String(clean.productId) !== String(cur.productId ?? "")) {
      if (cur.productId) return badRequest("Détachez d'abord l'article actuel.");
      if (!isId(clean.productId)) return badRequest("Article du catalogue invalide.");
      const p = await ProductModel.findOne({ _id: clean.productId, ...tenantFilter(auth), isService: { $ne: true } }).select("trackingMode label").lean<{ _id: unknown; trackingMode?: string; label: string } | null>();
      if (!p) return badRequest("Article du catalogue introuvable (ou service).");
      if (await ActivityItemModel.exists({ ...tenantFilter(auth), deskId: cur.deskId, productId: p._id, archived: { $ne: true } })) return badRequest("Cet article du catalogue est déjà au comptoir.");
      try {
        await withTransaction(async session => {
          const whId = await deskWarehouse(auth.tenantId, cur.deskId, session);
          if ((cur.quantity ?? 0) > 0) {
            await applyMovement({
              tenantId: auth.tenantId, userId: auth.userId, productId: p._id, type: "entry", warehouseId: whId,
              quantity: cur.quantity, unitCost: cur.unitCost || undefined, reason: `Reprise du stock du comptoir (${cur.name})`,
              lots: p.trackingMode && p.trackingMode !== "none" ? [{ lotNumber: "REPRISE-COMPTOIR", qty: cur.quantity }] : undefined,
              linkedDocType: "comptoir", linkedDocId: cur._id,
            }, session);
          }
          await ActivityItemModel.updateOne({ _id: cur._id }, { $set: { ...update, productId: p._id } }, { session });
        });
      } catch (e) { if (e instanceof StockError) return badRequest(e.message); throw e; }
      await syncLinkedItems(auth.tenantId, cur.deskId);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id), metadata: { linkedProduct: String(p._id) } });
      return ok(await ActivityItemModel.findById(cur._id).lean());
    }
    if (!clean.productId && cur.productId) {
      await syncLinkedItems(auth.tenantId, cur.deskId);
      await ActivityItemModel.updateOne({ _id: cur._id }, { $unset: { productId: 1 } });
    }
  }
  const item = await ActivityItemModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) }, { $set: update }, { new: true }
  );
  if (!item) return notFound("Article introuvable");
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id) });
  return ok(item);
});

export const DELETE = withAuth("comptoir", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Article introuvable");
  const r = await ActivityItemModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) });
  if (!r) return notFound("Article introuvable");
  await logAudit(auth, "DELETE", "comptoir", { resourceId: String(params.id) });
  return noContent();
});
