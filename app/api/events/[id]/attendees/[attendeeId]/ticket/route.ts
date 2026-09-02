import { NextRequest, NextResponse } from "next/server";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { EventModel } from "@/models/Event";
import { AttendeeModel } from "@/models/Attendee";
import { buildTicketPdf, sendTicketEmail, sendTicketWhatsApp, TicketInfo } from "@/lib/ticket-delivery";
import { TokenPayload } from "@/lib/auth";

async function buildInfo(auth: TokenPayload, eventId: string, attendeeId: string): Promise<TicketInfo | null> {
  const [ev, at] = await Promise.all([
    EventModel.findOne({ _id: eventId, ...tenantFilter(auth) }).lean(),
    AttendeeModel.findOne({ _id: attendeeId, eventId, ...tenantFilter(auth) }).lean(),
  ]);
  if (!ev || !at) return null;
  const e = ev as unknown as { title: string; startAt: string | Date; endAt?: string | Date; locationType: string; address?: string; meetingLink?: string };
  const a = at as unknown as { _id: unknown; firstName: string; lastName: string; ticketTypeName?: string; amount?: number; ticketCode: string };
  const locationLabel = e.locationType === "online" ? (e.meetingLink || "En ligne") : (e.address || "Lieu à préciser");
  return {
    eventTitle: e.title,
    start: new Date(e.startAt),
    end: e.endAt ? new Date(e.endAt) : undefined,
    locationLabel,
    attendeeId: String(a._id),
    attendeeName: `${a.firstName} ${a.lastName}`,
    ticketTypeName: a.ticketTypeName,
    amount: a.amount,
    ticketCode: a.ticketCode,
  };
}

// Téléchargement du billet PDF.
export const GET = withAuth("events", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const info = await buildInfo(auth, params.id, params.attendeeId);
  if (!info) return notFound("Billet introuvable");
  const pdf = await buildTicketPdf(info);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="billet-${info.ticketCode}.pdf"`,
    },
  });
});

// Renvoi du billet par email.
export const POST = withAuth("events", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  const info = await buildInfo(auth, params.id, params.attendeeId);
  if (!info) return notFound("Billet introuvable");
  const at = await AttendeeModel.findOne({ _id: params.attendeeId, eventId: params.id, ...tenantFilter(auth) })
    .select("email phone").lean() as { email?: string; phone?: string } | null;
  if (!at?.email && !at?.phone) return badRequest("Ce participant n'a ni email ni téléphone");
  const baseUrl = process.env.APP_BASE_URL || "https://kanoo.ne";
  let emailSent = false;
  let whatsappSent = false;
  if (at.email) emailSent = (await sendTicketEmail(at.email, info, baseUrl)).sent;
  if (at.phone) whatsappSent = (await sendTicketWhatsApp(at.phone, info)).sent;
  if (!emailSent && !whatsappSent) return badRequest("Envoi impossible");
  return ok({ sent: true, emailSent, whatsappSent });
});
