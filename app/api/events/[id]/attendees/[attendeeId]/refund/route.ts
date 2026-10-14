import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { AttendeeModel } from "@/models/Attendee";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

import { withTransaction } from "@/lib/db";
import { unpostAttendee } from "@/lib/event-posting";
/**
 * Remboursement d'un billet : marque le billet « remboursé » (annule sa validité
 * et libère la jauge), avec motif horodaté. Si le billet était comptabilisé, sa
 * recette est extournée et l'argent rendu sort du compte qui l'avait reçu.
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
  // Recette comptabilisée : extournée, et l'argent rendu sort de la même caisse.
  await withTransaction(async session => {
    await unpostAttendee({ tenantId: auth.tenantId, userId: auth.userId }, attendee, "Billet remboursé", session);
    await attendee.save({ session });
  });

  await logAudit(auth, "REFUND", "events", {
    resourceId: String(params.id),
    metadata: { attendeeId: attendee._id.toString() },
  });
  return ok({ refundedAt: attendee.refundedAt, amount: attendee.amount });
});
