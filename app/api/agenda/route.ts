import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { CalendarEventModel } from "@/models/CalendarEvent";
import { visibleFilter } from "@/lib/agenda";
import { logAudit } from "@/lib/audit";
import { virtualAgenda, RESERVED_CALENDARS } from "@/lib/agenda-virtual";

export const dynamic = "force-dynamic";

const TYPES = ["reunion", "activite", "tache", "rappel", "autre"];

/** GET /api/agenda?from=&to=&scope=mine|shared|all — entrées visibles sur une fenêtre. */
export const GET = withAuth("agenda", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const scope = url.searchParams.get("scope") || "all";
  const me = new Types.ObjectId(auth.userId);

  const filter: Record<string, unknown> = { ...visibleFilter(auth) };
  if (scope === "mine") filter.$or = [{ ownerId: me }, { participants: me }];
  else if (scope === "shared") filter.$or = [{ visibility: "shared" }];

  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lt = new Date(to);
    filter.startAt = range;
  }

  const items = await CalendarEventModel.find(filter)
    .sort({ startAt: 1 })
    .limit(500)
    .populate("ownerId", "firstName lastName")
    .populate("participants", "firstName lastName")
    .lean();
  // Échéances des marchés publics et jours fériés : en lecture seule, ajoutés à la vue « Tout ».
  if (url.searchParams.get("virtual") === "1" && scope === "all" && from && to) {
    return ok([...items, ...(await virtualAgenda(auth, new Date(from), new Date(to)))]);
  }
  return ok(items);
});

/** POST /api/agenda — créer une entrée (propriétaire = l'utilisateur courant). */
export const POST = withAuth("agenda", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  if (!title) return badRequest("Le titre est obligatoire.");
  const startAt = body.startAt ? new Date(body.startAt) : null;
  if (!startAt || isNaN(startAt.getTime())) return badRequest("Date de début invalide.");
  const endAt = body.endAt ? new Date(body.endAt) : undefined;
  if (endAt && !isNaN(endAt.getTime()) && endAt < startAt) return badRequest("La fin est avant le début.");

  const participants = Array.isArray(body.participants)
    ? body.participants.filter((id: unknown) => typeof id === "string" && Types.ObjectId.isValid(id)).slice(0, 100)
    : [];

  const item = await CalendarEventModel.create({
    tenantId: auth.tenantId,
    title: title.slice(0, 200),
    description: String(body.description || "").slice(0, 4000),
    type: TYPES.includes(body.type) ? body.type : "reunion",
    startAt,
    endAt: endAt && !isNaN(endAt.getTime()) ? endAt : undefined,
    allDay: Boolean(body.allDay),
    location: String(body.location || "").slice(0, 300),
    meetingLink: String(body.meetingLink || "").slice(0, 500),
    color: typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : undefined,
    ownerId: auth.userId,
    visibility: body.visibility === "shared" ? "shared" : "personal",
    ...(String(body.calendar ?? "").trim() && !RESERVED_CALENDARS.includes(String(body.calendar).trim()) ? { calendar: String(body.calendar).trim().slice(0, 60) } : {}),
    participants,
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "agenda", { resourceId: item._id.toString(), metadata: { type: item.type, visibility: item.visibility } });
  return created(item);
});
