import { RESERVED_CALENDARS } from "@/lib/agenda-virtual";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden, noContent, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { CalendarEventModel } from "@/models/CalendarEvent";
import { visibleFilter } from "@/lib/agenda";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const TYPES = ["reunion", "activite", "tache", "rappel", "autre"];
const STATUS = ["planned", "done", "cancelled"];

/** L'utilisateur peut-il modifier/supprimer ? Propriétaire ou administrateur. */
function canEdit(auth: TokenPayload, ownerId: unknown): boolean {
  const roles = [auth.role, ...(auth.roles ?? [])];
  const isAdmin = roles.some((r) => typeof r === "string" && (r.endsWith("_admin") || r === "superadmin" || r === "asso_president" || r === "admin_ordonnateur"));
  return String(ownerId) === String(auth.userId) || isAdmin;
}

export const GET = withAuth("agenda", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await CalendarEventModel.findOne({ _id: params.id, ...visibleFilter(auth) })
    .populate("ownerId", "firstName lastName")
    .populate("participants", "firstName lastName")
    .lean();
  if (!item) return notFound("Entrée d'agenda introuvable");
  return ok(item);
});

export const PATCH = withAuth("agenda", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const existing = await CalendarEventModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean<{ ownerId: unknown } | null>();
  if (!existing) return notFound("Entrée d'agenda introuvable");
  if (!canEdit(auth, existing.ownerId)) return forbidden("Vous ne pouvez modifier que vos propres entrées.");

  const body = await req.json().catch(() => ({}));
  const set: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) return badRequest("Le titre est obligatoire.");
    set.title = t.slice(0, 200);
  }
  if (body.description !== undefined) set.description = String(body.description).slice(0, 4000);
  if (body.type !== undefined && TYPES.includes(body.type)) set.type = body.type;
  if (body.status !== undefined && STATUS.includes(body.status)) set.status = body.status;
  if (body.startAt !== undefined) {
    const d = new Date(body.startAt);
    if (isNaN(d.getTime())) return badRequest("Date de début invalide.");
    set.startAt = d;
  }
  if (body.endAt !== undefined) set.endAt = body.endAt ? new Date(body.endAt) : null;
  if (body.allDay !== undefined) set.allDay = Boolean(body.allDay);
  if (body.location !== undefined) set.location = String(body.location).slice(0, 300);
  if (body.meetingLink !== undefined) set.meetingLink = String(body.meetingLink).slice(0, 500);
  if (body.visibility !== undefined) set.visibility = body.visibility === "shared" ? "shared" : "personal";
  // « Marchés publics » et « Jours fériés » sont réservés aux entrées calculées.
  if (body.calendar !== undefined) { const c = String(body.calendar ?? "").trim().slice(0, 60); set.calendar = RESERVED_CALENDARS.includes(c) ? "" : c; }
  if (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) set.color = body.color;
  if (Array.isArray(body.participants)) {
    set.participants = body.participants.filter((id: unknown) => typeof id === "string" && Types.ObjectId.isValid(id)).slice(0, 100);
  }

  const item = await CalendarEventModel.findByIdAndUpdate(params.id, { $set: set }, { new: true, runValidators: true }).lean();
  await logAudit(auth, "UPDATE", "agenda", { resourceId: String(params.id) });
  return ok(item);
});

export const DELETE = withAuth("agenda", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const existing = await CalendarEventModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean<{ ownerId: unknown } | null>();
  if (!existing) return notFound("Entrée d'agenda introuvable");
  if (!canEdit(auth, existing.ownerId)) return forbidden("Vous ne pouvez supprimer que vos propres entrées.");
  await CalendarEventModel.deleteOne({ _id: params.id });
  await logAudit(auth, "DELETE", "agenda", { resourceId: String(params.id) });
  return noContent();
});
