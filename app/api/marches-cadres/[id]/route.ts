import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { FrameworkOrderModel } from "@/models/FrameworkOrder";
import { DeliveryLotModel } from "@/models/DeliveryLot";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = withAuth("commandes", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const [order, lots] = await Promise.all([
    FrameworkOrderModel.findOne({ _id: params.id, ...tenantFilter(auth) })
      .populate("clientId", "name code nif address phone")
      .populate("productId", "label unit")
      .populate("inputProductId", "label unit stockQty").lean(),
    DeliveryLotModel.find({ ...tenantFilter(auth), frameworkOrderId: params.id })
      .sort({ date: -1 }).lean(),
  ]);
  if (!order) return notFound("Marché introuvable");
  return ok({ order, lots });
});

export const PATCH = withAuth("commandes", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  // Quantités et reference jamais modifiées à la main : elles portent des
  // invariants (livré/facturé) et sont pilotées par les lots.
  const update = sanitizeBody(body, ["title", "unitPrice", "tvaRate", "startDate", "endDate", "notes", "status", "inputPerUnit"]);
  if (update.status === "completed") return badRequest("Un marché se complète en livrant, pas à la main.");
  const order = await FrameworkOrderModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, { $set: update }, { new: true });
  if (!order) return notFound("Marché introuvable");
  await logAudit(auth, "UPDATE", "commandes", { resourceId: String(params.id) });
  return ok(order);
});

export const DELETE = withAuth("commandes", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const lotCount = await DeliveryLotModel.countDocuments({ ...tenantFilter(auth), frameworkOrderId: params.id });
  if (lotCount > 0) return badRequest("Ce marché a des lots livrés : annulez-le plutôt que de le supprimer.");
  const r = await FrameworkOrderModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) });
  if (!r) return notFound("Marché introuvable");
  await logAudit(auth, "DELETE", "commandes", { resourceId: String(params.id) });
  return noContent();
});
