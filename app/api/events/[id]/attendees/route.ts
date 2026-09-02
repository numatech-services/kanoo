import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth, ok, created, badRequest, notFound, conflict, tenantFilter, requireFields } from "@/lib/api-helpers";
import { EventModel, ITicketType } from "@/models/Event";
import { AttendeeModel } from "@/models/Attendee";
import { generateTicketCode, signTicket, buildQrPayload } from "@/lib/ticketing";
import { sendTicketEmail, sendTicketWhatsApp } from "@/lib/ticket-delivery";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

// Liste des participants + statistiques de présence.
export const GET = withAuth("events", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const filter: Record<string, unknown> = { eventId: params.id, ...tenantFilter(auth) };
  if (status) filter.status = status;

  const attendees = await AttendeeModel.find(filter).sort({ createdAt: -1 }).lean();

  const all = await AttendeeModel.find({ eventId: params.id, ...tenantFilter(auth) }).select("status amount").lean();
  const stats = { total: all.length, present: 0, registered: 0, cancelled: 0, refunded: 0, revenue: 0 };
  for (const a of all as Array<{ status: string; amount?: number }>) {
    if (a.status === "present") stats.present++;
    else if (a.status === "cancelled") stats.cancelled++;
    else if (a.status === "refunded") stats.refunded++;
    else stats.registered++;
    if (["registered", "paid", "present"].includes(a.status)) stats.revenue += a.amount || 0;
  }
  const absent = Math.max(0, stats.total - stats.cancelled - stats.refunded - stats.present);

  return ok({ attendees, stats: { ...stats, absent } });
});

// Inscription d'un participant (émet un billet unique + QR signé).
export const POST = withAuth("events", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const err = requireFields(body, ["firstName", "lastName"]);
  if (err) return badRequest(err);

  const ev = await EventModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean() as
    | {
        _id: Types.ObjectId; status: string; capacity: number; isPaid: boolean; ticketTypes: ITicketType[];
        title: string; startAt: string | Date; endAt?: string | Date;
        locationType: string; address?: string; meetingLink?: string; sendConfirmation: boolean;
      }
    | null;
  if (!ev) return notFound("Activité introuvable");
  if (ev.status === "cancelled") return badRequest("Activité annulée");

  if (ev.capacity && ev.capacity > 0) {
    const count = await AttendeeModel.countDocuments({ eventId: params.id, status: { $nin: ["cancelled", "refunded"] } });
    if (count >= ev.capacity) return conflict("Jauge maximale atteinte");
  }

  let ticketTypeName: string | undefined;
  let ticketTypeId: Types.ObjectId | undefined;
  let amount = 0;
  if (ev.isPaid && body.ticketTypeId) {
    const tt = (ev.ticketTypes || []).find((t) => String(t._id) === String(body.ticketTypeId));
    if (!tt) return badRequest("Type de billet invalide");
    ticketTypeName = tt.name;
    ticketTypeId = tt._id;
    amount = tt.price;
  }

  // Code unique par organisation.
  let ticketCode = generateTicketCode();
  for (let i = 0; i < 5; i++) {
    const exists = await AttendeeModel.exists({ tenantId: auth.tenantId, ticketCode });
    if (!exists) break;
    ticketCode = generateTicketCode();
  }

  const _id = new Types.ObjectId();
  const qrSig = signTicket(_id.toString(), ticketCode);

  // Statut initial : gratuit → inscrit ; payant → payé si réglé (ex. espèces sur
  // place) sinon en attente ; vente sur place (checkin) → présent immédiatement.
  let status: "registered" | "paid" | "present" = ev.isPaid ? (body.markPaid ? "paid" : "registered") : "registered";
  if (body.checkin) status = "present";
  const nowDate = new Date();

  const attendee = await AttendeeModel.create({
    _id,
    tenantId: auth.tenantId,
    eventId: ev._id,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    ticketTypeId,
    ticketTypeName,
    amount,
    ticketCode,
    qrSig,
    status,
    checkedInAt: body.checkin ? nowDate : undefined,
    checkedInBy: body.checkin ? new Types.ObjectId(auth.userId) : undefined,
    createdBy: new Types.ObjectId(auth.userId),
  });

  // Livraison du billet (email PDF+.ics et/ou WhatsApp) — best-effort, non bloquant.
  // Envoyé si l'inscription est confirmée : gratuit, ou payant déjà réglé.
  let emailSent = false;
  let whatsappSent = false;
  if (ev.sendConfirmation && (!ev.isPaid || status === "paid" || status === "present")) {
    const baseUrl = process.env.APP_BASE_URL || "https://kanoo.ne";
    const locationLabel = ev.locationType === "online" ? (ev.meetingLink || "En ligne") : (ev.address || "Lieu à préciser");
    const info = {
      eventTitle: ev.title,
      start: new Date(ev.startAt),
      end: ev.endAt ? new Date(ev.endAt) : undefined,
      locationLabel,
      attendeeId: attendee._id.toString(),
      attendeeName: `${attendee.firstName} ${attendee.lastName}`,
      ticketTypeName: attendee.ticketTypeName,
      amount: attendee.amount,
      ticketCode: attendee.ticketCode,
    };
    if (attendee.email) { try { emailSent = (await sendTicketEmail(attendee.email, info, baseUrl)).sent; } catch { /* non bloquant */ } }
    if (attendee.phone) { try { whatsappSent = (await sendTicketWhatsApp(attendee.phone, info)).sent; } catch { /* non bloquant */ } }
  }

  await logAudit(auth, "CREATE", "events", { resourceId: String(ev._id), attendeeId: attendee._id.toString() });
  return created({ attendee, qrPayload: buildQrPayload(attendee._id.toString(), ticketCode), emailSent, whatsappSent });
});
