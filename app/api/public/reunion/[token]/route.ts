import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { resolveParams, RouteContext } from "@/lib/api-helpers";
import { CalendarEventModel } from "@/models/CalendarEvent";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/reunion/[token] — détails PUBLICS d'une réunion partagée, en
 * lecture seule, sans authentification. On ne renvoie que ce qui est utile à un
 * invité : objet, horaires, lieu, lien visio, notes, et le nom de l'organisation
 * émettrice. Ni participants, ni identifiants internes.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { token } = await resolveParams(ctx);
  if (!token || token.length < 8) {
    return NextResponse.json({ success: false, error: "Lien invalide." }, { status: 400 });
  }
  await connectDB();
  const ev = await CalendarEventModel.findOne({ shareToken: token })
    .select("title description type startAt endAt allDay location meetingLink status ownerId tenantId")
    .populate("ownerId", "firstName lastName")
    .populate("tenantId", "name logo")
    .lean<Record<string, unknown> | null>();

  if (!ev) return NextResponse.json({ success: false, error: "Réunion introuvable ou lien révoqué." }, { status: 404 });

  const owner = ev.ownerId as { firstName?: string; lastName?: string } | undefined;
  const org = ev.tenantId as { name?: string; logo?: string } | undefined;
  return NextResponse.json({
    success: true,
    data: {
      title: ev.title, description: ev.description, type: ev.type,
      startAt: ev.startAt, endAt: ev.endAt, allDay: ev.allDay,
      location: ev.location, meetingLink: ev.meetingLink, status: ev.status,
      organizer: [owner?.firstName, owner?.lastName].filter(Boolean).join(" ") || null,
      orgName: org?.name || null, orgLogo: org?.logo || null,
    },
  });
}
