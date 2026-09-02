import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AttendeeModel } from "@/models/Attendee";
import { parseQrPayload, verifyTicket } from "@/lib/ticketing";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * Vérification d'un billet + pointage « présent ».
 * Accepte soit { payload } (contenu du QR), soit { code } (code de secours).
 * Réponses : { valid: boolean, reason?, attendee? }.
 */
export const POST = withAuth("events", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();

  let attendeeId: string | undefined;
  let sig: string | undefined;
  let ticketCode: string | undefined;

  if (body.payload) {
    const parsed = parseQrPayload(String(body.payload));
    if (!parsed) return ok({ valid: false, reason: "QR illisible" });
    attendeeId = parsed.attendeeId;
    ticketCode = parsed.ticketCode;
    sig = parsed.sig;
  } else if (body.code) {
    ticketCode = String(body.code).trim().toUpperCase();
  } else {
    return badRequest("QR ou code requis");
  }

  const query: Record<string, unknown> = { eventId: params.id, ...tenantFilter(auth) };
  if (attendeeId) query._id = attendeeId;
  else query.ticketCode = ticketCode;

  const attendee = await AttendeeModel.findOne(query);
  if (!attendee) return ok({ valid: false, reason: "Billet inconnu" });

  // Validation cryptographique si le billet vient d'un QR.
  if (sig && !verifyTicket(attendee._id.toString(), attendee.ticketCode, sig)) {
    return ok({ valid: false, reason: "Signature invalide" });
  }
  if (attendee.status === "cancelled" || attendee.status === "refunded") {
    return ok({ valid: false, reason: "Billet annulé" });
  }
  if (attendee.status === "present") {
    return ok({
      valid: false,
      reason: "Déjà pointé",
      attendee: { firstName: attendee.firstName, lastName: attendee.lastName, checkedInAt: attendee.checkedInAt },
    });
  }

  attendee.status = "present";
  attendee.checkedInAt = new Date();
  attendee.checkedInBy = new Types.ObjectId(auth.userId);
  await attendee.save();

  await logAudit(auth, "UPDATE", "events", { resourceId: String(params.id), attendeeId: attendee._id.toString(), action: "checkin" });
  return ok({
    valid: true,
    attendee: {
      firstName: attendee.firstName,
      lastName: attendee.lastName,
      ticketTypeName: attendee.ticketTypeName,
      checkedInAt: attendee.checkedInAt,
    },
  });
});
