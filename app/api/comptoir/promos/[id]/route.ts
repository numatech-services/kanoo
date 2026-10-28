import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, deskFilter } from "@/lib/comptoir";
import { DeskPromoModel } from "@/models/DeskPromo";
import { promoFields } from "@/lib/desk-promo";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** PATCH — modifie une promotion (ou { active: false } pour l'arrêter). */
export const PATCH = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound();
  const cur = await DeskPromoModel.findOne({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) }).lean<Record<string, unknown> | null>();
  if (!cur) return notFound("Promotion introuvable");
  const body = await req.json().catch(() => ({}));
  const f = promoFields({ ...cur, itemIds: (cur.itemIds as unknown[] | undefined)?.map(String), ...body });
  if (typeof f === "string") return badRequest(f);
  const p = await DeskPromoModel.findByIdAndUpdate(params.id, { $set: f }, { new: true });
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: params.id, metadata: { promo: f.name, active: f.active } });
  return ok(p);
});

/** DELETE — supprime une promotion (les tickets passés gardent son nom). */
export const DELETE = withAuth("comptoir", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound();
  const r = await DeskPromoModel.deleteOne({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) });
  if (!r.deletedCount) return notFound("Promotion introuvable");
  await logAudit(auth, "DELETE", "comptoir", { resourceId: params.id });
  return noContent();
});
