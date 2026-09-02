import { NextRequest } from "next/server";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { EventModel } from "@/models/Event";
import { AttendeeModel } from "@/models/Attendee";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("events", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const upcoming = url.searchParams.get("upcoming");

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (status) filter.status = status;
  if (upcoming === "1") {
    filter.startAt = { $gte: new Date() };
    filter.status = { $ne: "cancelled" };
  }

  const [items, total] = await Promise.all([
    EventModel.find(filter).sort(upcoming === "1" ? { startAt: 1 } : { startAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    EventModel.countDocuments(filter),
  ]);

  // Nombre d'inscrits et de présents par événement.
  const ids = (items as Array<{ _id: unknown }>).map((e) => e._id);
  const counts = await AttendeeModel.aggregate([
    { $match: { eventId: { $in: ids }, status: { $ne: "cancelled" } } },
    { $group: { _id: "$eventId", registered: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } } } },
  ]);
  const byId = new Map<string, { registered: number; present: number }>(
    (counts as Array<{ _id: unknown; registered: number; present: number }>).map((c) => [String(c._id), { registered: c.registered, present: c.present }])
  );
  const enriched = (items as Array<Record<string, unknown> & { _id: unknown }>).map((e) => ({
    ...e,
    registered: byId.get(String(e._id))?.registered || 0,
    present: byId.get(String(e._id))?.present || 0,
  }));

  return paginatedResponse(enriched, total, pagination);
});

export const POST = withAuth("events", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["title", "startAt"]);
  if (err) return badRequest(err);

  const isPaid = !!body.isPaid;
  const ticketTypes = Array.isArray(body.ticketTypes) ? body.ticketTypes : [];

  const ev = await EventModel.create({
    tenantId: auth.tenantId,
    title: body.title,
    description: body.description,
    coverImage: body.coverImage,
    category: body.category,
    tags: Array.isArray(body.tags) ? body.tags : [],
    startAt: body.startAt,
    endAt: body.endAt || undefined,
    timezone: body.timezone || "Africa/Niamey",
    locationType: body.locationType === "online" ? "online" : "physical",
    address: body.address,
    lat: body.lat,
    lng: body.lng,
    meetingLink: body.meetingLink,
    capacity: Number(body.capacity) || 0,
    visibility: body.visibility === "private" ? "private" : "public",
    isPaid,
    ticketTypes: isPaid ? ticketTypes : [],
    status: body.status === "published" ? "published" : "draft",
    sendConfirmation: body.sendConfirmation !== false,
    reminderHoursBefore: Number(body.reminderHoursBefore) || 24,
    createdBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "events", { resourceId: ev._id.toString(), after: { title: ev.title } });
  return created(ev);
});
