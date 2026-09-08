import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { StockMovementModel } from "@/models/StockMovement";
import { ProductModel } from "@/models/Product";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/stock/movements/[id] — annule un mouvement de stock erroné.
 *
 * Le mouvement porte son écart signé (`quantity`) ; on le retire donc de la
 * quantité courante du produit avant de supprimer la ligne. On ne réécrit pas
 * l'historique des mouvements suivants : seule la quantité courante est
 * recalée (borne à 0).
 */
export const DELETE = withAuth("products", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const mv = await StockMovementModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!mv) return notFound("Mouvement introuvable");

  const product = await ProductModel.findOne({ _id: mv.productId, ...tenantFilter(auth) });
  if (product) {
    product.stockQty = Math.max(0, (product.stockQty || 0) - (mv.quantity || 0));
    await product.save();
  }
  await StockMovementModel.deleteOne({ _id: mv._id });
  await logAudit(auth, "DELETE", "stock", { resourceId: String(params.id), metadata: { revertedDelta: mv.quantity } });
  return noContent();
});

/** PATCH — corriger le motif d'un mouvement (sans toucher aux quantités). */
export const PATCH = withAuth("products", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  const mv = await StockMovementModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) },
    { $set: { reason: reason.slice(0, 300) } },
    { new: true }
  ).lean();
  if (!mv) return notFound("Mouvement introuvable");
  await logAudit(auth, "UPDATE", "stock", { resourceId: String(params.id) });
  return ok(mv);
});
