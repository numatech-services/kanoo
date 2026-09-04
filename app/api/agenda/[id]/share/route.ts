import { NextRequest } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { CalendarEventModel } from "@/models/CalendarEvent";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function canShare(auth: TokenPayload, ownerId: unknown): boolean {
  const roles = [auth.role, ...(auth.roles ?? [])];
  const isAdmin = roles.some((r) => typeof r === "string" && (r.endsWith("_admin") || r === "superadmin" || r === "asso_president" || r === "admin_ordonnateur"));
  return String(ownerId) === String(auth.userId) || isAdmin;
}

/** POST /api/agenda/[id]/share — génère (ou renvoie) un lien public de réunion. */
export const POST = withAuth("agenda", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const ev = await CalendarEventModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!ev) return notFound("Événement introuvable");
  if (!canShare(auth, ev.ownerId)) return forbidden("Vous ne pouvez partager que vos propres événements.");

  if (!ev.shareToken) {
    ev.shareToken = crypto.randomBytes(16).toString("hex");
    await ev.save();
    await logAudit(auth, "UPDATE", "agenda", { resourceId: String(params.id), metadata: { action: "share" } });
  }
  return ok({ token: ev.shareToken, path: `/reunion/${ev.shareToken}` });
});

/** DELETE /api/agenda/[id]/share — révoque le lien public. */
export const DELETE = withAuth("agenda", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const ev = await CalendarEventModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!ev) return notFound("Événement introuvable");
  if (!canShare(auth, ev.ownerId)) return forbidden("Action non autorisée.");
  ev.shareToken = undefined;
  await ev.save();
  await logAudit(auth, "UPDATE", "agenda", { resourceId: String(params.id), metadata: { action: "unshare" } });
  return ok({ revoked: true });
});
