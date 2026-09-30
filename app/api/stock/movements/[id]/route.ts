import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { StockMovementModel } from "@/models/StockMovement";
import { reverseMovement, StockError } from "@/lib/stock";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/stock/movements/[id] — annule un mouvement erroné par un
 * contre-mouvement. L'historique n'est jamais effacé : l'ancienne version
 * supprimait la ligne et recalait le stock en le bornant à zéro.
 */
export const DELETE = withAuth("products", "delete", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const reason = new URL(req.url).searchParams.get("reason") ?? undefined;
  try {
    const r = await withTransaction(session => reverseMovement({ tenantId: auth.tenantId, userId: auth.userId, movementId: params.id, reason }, session));
    await logAudit(auth, "UPDATE", "stock", { resourceId: String(params.id), metadata: { reversed: true, delta: r.delta } });
    return ok({ reversal: r.movement._id, stockQty: r.after });
  } catch (e) {
    if (e instanceof StockError) return /introuvable/.test(e.message) ? notFound(e.message) : badRequest(e.message);
    throw e;
  }
});

/** PATCH — corriger le motif d'un mouvement (sans toucher aux quantités). */
export const PATCH = withAuth("products", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (!reason) return badRequest("Motif obligatoire.");
  const mv = await StockMovementModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, { $set: { reason: reason.slice(0, 300) } }, { new: true },
  ).lean();
  if (!mv) return notFound("Mouvement introuvable");
  await logAudit(auth, "UPDATE", "stock", { resourceId: String(params.id) });
  return ok(mv);
});
