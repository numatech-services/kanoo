import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
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
  // LISTE BLANCHE. `sanitizeBody` RETIRE les champs qu'on lui passe : la liste
  // des champs autorisés lui était donnée, si bien que titre, prix, TVA et
  // statut étaient ignorés tandis que quantités livrées / facturées, client et
  // référence devenaient modifiables (invariant commandé ≥ livré ≥ facturé
  // cassé). Quantités, client et référence sont pilotés par les lots.
  const update: Record<string, unknown> = {};
  if ("title" in body) { const t = String(body.title ?? "").trim(); if (!t) return badRequest("Intitulé requis."); update.title = t.slice(0, 200); }
  if ("unitPrice" in body) { const v = Number(body.unitPrice); if (!(v >= 0)) return badRequest("Prix unitaire invalide."); update.unitPrice = Math.round(v); }
  if ("tvaRate" in body) { const v = Number(body.tvaRate); if (!(v >= 0 && v < 1)) return badRequest("Taux de TVA invalide (fraction : 0,19)."); update.tvaRate = v; }
  if ("inputPerUnit" in body) { const v = Number(body.inputPerUnit); if (!(v >= 0)) return badRequest("Consommation d'intrant invalide."); update.inputPerUnit = v; }
  for (const k of ["startDate", "endDate"]) {
    if (!(k in body)) continue;
    if (!body[k]) { update[k] = null; continue; }
    const d = new Date(String(body[k])); if (isNaN(d.getTime())) return badRequest("Date invalide."); update[k] = d;
  }
  if ("notes" in body) update.notes = String(body.notes ?? "").slice(0, 2000);
  if ("status" in body) {
    if (body.status === "completed") return badRequest("Un marché se complète en livrant, pas à la main.");
    if (!["draft", "active", "cancelled"].includes(String(body.status))) return badRequest("Statut invalide.");
    update.status = body.status;
  }
  const order = await FrameworkOrderModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, { $set: update }, { new: true, runValidators: true });
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
