import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicBatchModel, IIsicDelivery } from "@/models/IsicBatch";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/isic/[id]/delivery — enregistre une livraison PARTIELLE (au fur et à
 * mesure). Refuse de dépasser le total de cartes. Fait avancer le statut :
 * première livraison → « delivering » ; tout livré → « completed ».
 * DELETE ?deliveryId=… retire une livraison.
 */
export const POST = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const quantity = Math.floor(Number(body.quantity));
  if (!quantity || quantity < 1) return badRequest("Quantité livrée invalide.");

  const batch = await IsicBatchModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!batch) return notFound("Lot ISIC introuvable");

  const delivered = batch.deliveries.reduce((s: number, d: IIsicDelivery) => s + d.quantity, 0);
  if (delivered + quantity > batch.totalCards) {
    return badRequest(`Reste à livrer : ${batch.totalCards - delivered} carte(s).`);
  }

  batch.deliveries.push({ date: body.date ? new Date(body.date) : new Date(), quantity, note: String(body.note || "").slice(0, 300) });
  const newDelivered = delivered + quantity;
  if (newDelivered >= batch.totalCards && batch.totalCards > 0) batch.status = "completed";
  else if (!["delivering", "completed", "cancelled"].includes(batch.status)) batch.status = "delivering";
  await batch.save();

  await logAudit(auth, "UPDATE", "isic", { resourceId: String(params.id), metadata: { delivered: quantity } });
  return ok(batch);
});

export const DELETE = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const deliveryId = new URL(req.url).searchParams.get("deliveryId");
  if (!deliveryId) return badRequest("Livraison non précisée.");
  const batch = await IsicBatchModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!batch) return notFound("Lot ISIC introuvable");
  batch.deliveries = batch.deliveries.filter((d: IIsicDelivery) => String(d._id) !== deliveryId) as typeof batch.deliveries;
  await batch.save();
  return ok(batch);
});
