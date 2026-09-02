import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { EventModel } from "@/models/Event";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("events", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const ev = await EventModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!ev) return notFound("Activité introuvable");
  return ok(ev);
});

export const PATCH = withAuth("events", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  // Champs protégés : jamais réaffectés depuis le corps.
  for (const k of ["_id", "tenantId", "createdBy", "createdAt", "updatedAt"]) delete body[k];
  const ev = await EventModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) },
    { $set: body },
    { new: true }
  );
  if (!ev) return notFound("Activité introuvable");
  await logAudit(auth, "UPDATE", "events", { resourceId: params.id });
  return ok(ev);
});

export const DELETE = withAuth("events", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  // Annulation logique (conserve billets/présences pour l'historique).
  const ev = await EventModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) },
    { $set: { status: "cancelled" } },
    { new: true }
  );
  if (!ev) return notFound("Activité introuvable");
  await logAudit(auth, "DELETE", "events", { resourceId: params.id });
  return noContent();
});
