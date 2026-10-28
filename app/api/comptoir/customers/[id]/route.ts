import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, deskFilter } from "@/lib/comptoir";
import { DeskCustomerModel, DeskCustomerMoveModel } from "@/models/DeskCustomer";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET — fiche de l'ardoise et ses mouvements (ventes, règlements, annulations). */
export const GET = withAuth("comptoir", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound();
  const c = await DeskCustomerModel.findOne({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) }).lean();
  if (!c) return notFound("Client introuvable");
  const moves = await DeskCustomerMoveModel.find({ ...tenantFilter(auth), customerId: params.id }).sort({ date: -1 }).limit(200).lean();
  return ok({ customer: c, moves });
});

/** PATCH { name?, phone?, creditLimit?, active? } */
export const PATCH = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound();
  const body = await req.json().catch(() => ({}));
  const $set: Record<string, unknown> = {};
  if ("name" in body) { const n = String(body.name ?? "").trim().slice(0, 120); if (!n) return badRequest("Nom obligatoire."); $set.name = n; }
  if ("phone" in body) $set.phone = String(body.phone ?? "").slice(0, 30) || undefined;
  if ("creditLimit" in body) { const l = Math.round(Number(body.creditLimit)); if (!(l >= 0)) return badRequest("Plafond invalide."); $set.creditLimit = l; }
  if ("active" in body) $set.active = !!body.active;
  const c = await DeskCustomerModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth), ...deskFilter(auth) }, { $set }, { new: true });
  if (!c) return notFound("Client introuvable");
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: params.id, metadata: { deskCustomer: $set } });
  return ok(c);
});
