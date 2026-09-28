import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicBatchModel, IIsicPayment } from "@/models/IsicBatch";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST /api/isic/[id]/payment — enregistre un encaissement de l'université.
 *  DELETE ?paymentId=… le retire. */
export const POST = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  if (!amount || amount <= 0) return badRequest("Montant invalide.");

  const batch = await IsicBatchModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!batch) return notFound("Lot ISIC introuvable");

  batch.payments.push({
    date: body.date ? new Date(body.date) : new Date(),
    amount,
    method: String(body.method || "").slice(0, 40),
    note: String(body.note || "").slice(0, 300),
  });
  await batch.save();
  await logAudit(auth, "PAYMENT", "isic", { resourceId: String(params.id), metadata: { amount } });
  return ok(batch);
});

export const DELETE = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const paymentId = new URL(req.url).searchParams.get("paymentId");
  if (!paymentId) return badRequest("Encaissement non précisé.");
  const batch = await IsicBatchModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!batch) return notFound("Lot ISIC introuvable");
  batch.payments = batch.payments.filter((p: IIsicPayment) => String(p._id) !== paymentId) as typeof batch.payments;
  await batch.save();
  return ok(batch);
});
