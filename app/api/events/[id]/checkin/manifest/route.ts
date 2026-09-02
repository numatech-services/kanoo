import { NextRequest } from "next/server";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { AttendeeModel } from "@/models/Attendee";
import { TokenPayload } from "@/lib/auth";

/**
 * Manifeste léger des billets d'une activité, pour le contrôle HORS-LIGNE.
 * Le scanner met cette liste en cache local ; il valide alors les entrées sans
 * réseau (seuls les billets réellement émis figurent ici) et met les pointages
 * en file de synchronisation. La vérification de signature reste faite côté
 * serveur au moment de la synchronisation.
 */
export const GET = withAuth("events", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  const list = await AttendeeModel.find({
    eventId: params.id,
    ...tenantFilter(auth),
    status: { $nin: ["cancelled", "refunded"] },
  }).select("firstName lastName ticketCode status").lean();

  const tickets = (list as Array<{ _id: unknown; firstName: string; lastName: string; ticketCode: string; status: string }>).map((a) => ({
    id: String(a._id),
    code: a.ticketCode,
    name: `${a.firstName} ${a.lastName}`,
    present: a.status === "present",
  }));

  return ok({ eventId: params.id, count: tickets.length, tickets });
});
