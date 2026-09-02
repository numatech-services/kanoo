import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { AttendeeModel } from "@/models/Attendee";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * Remboursement d'un billet : marque le billet « remboursé » (annule sa validité
 * et libère la jauge), avec motif horodaté. Le remboursement financier réel
 * (mobile money / carte / espèces) est réalisé hors flux et tracé ici.
 */
export const POST = withAuth("events", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json().catch(() => ({}));
  const attendee = await AttendeeModel.findOne({ _id: params.attendeeId, eventId: params.id, ...tenantFilter(auth) });
  if (!attendee) return notFound("Billet introuvable");
  if (attendee.status === "refunded") return badRequest("Billet déjà remboursé");
  if (attendee.status === "cancelled") return badRequest("Billet annulé");

  attendee.status = "refunded";
  attendee.refundedAt = new Date();
  attendee.refundReason = typeof body.reason === "string" ? body.reason.slice(0, 300) : undefined;
  await attendee.save();

  await logAudit(auth, "UPDATE", "events", { resourceId: String(params.id), attendeeId: attendee._id.toString(), action: "refund" });
  return ok({ refundedAt: attendee.refundedAt, amount: attendee.amount });
});
