import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { DonationModel } from "@/models/Donation";
import { withTransaction } from "@/lib/db";
import { unpost } from "@/lib/association-posting";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("dons", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const item = await DonationModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!item) return notFound(); return ok(item);
});

/** PATCH — informations du donateur seulement : le montant encaissé est en comptabilité. */
export const PATCH = withAuth("dons", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json().catch(() => ({}));
  const $set: Record<string, unknown> = {};
  for (const k of ["donorName", "donorType", "donorContact", "campaign", "notes", "paymentMethod"]) if (k in body) $set[k] = body[k];
  const item = await DonationModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set }, { new: true, runValidators: true });
  if (!item) return notFound(); await logAudit(auth, "UPDATE", "dons", { resourceId: params.id }); return ok(item);
});

/** DELETE — don saisi par erreur : l'écriture est extournée, la trésorerie corrigée. */
export const DELETE = withAuth("dons", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const d = await DonationModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!d) return noContent();
  await withTransaction(async session => {
    await unpost(auth, d, "Don supprimé", session);
    await DonationModel.deleteOne({ _id: d._id }, { session });
  });
  await logAudit(auth, "DELETE", "dons", { resourceId: params.id });
  return noContent();
});
