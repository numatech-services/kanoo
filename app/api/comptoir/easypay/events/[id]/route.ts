import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, forbidden, notFound, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { IntegrationEventModel } from "@/models/IntegrationEvent";
import { replayEvent } from "@/lib/easypay-server";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET — un événement reçu d'EasyPay, avec son contenu tel que reçu. */
export const GET = withAuth("comptoir", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  if (!canSeeDeskCosts(auth)) return forbidden("Réservé au chef du comptoir et à la finance.");
  if (!isId(params.id)) return notFound();
  const ev = await IntegrationEventModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean<{ deskId: unknown } | null>();
  if (!ev || !(await ownDesk(auth, String(ev.deskId)))) return notFound("Événement introuvable");
  return ok(ev);
});

/** POST { action: replay | ignore, note? } — rejoue un événement en échec, ou l'écarte. */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!canSeeDeskCosts(auth)) return forbidden("Réservé au chef du comptoir et à la finance.");
  if (!isId(params.id)) return notFound();
  const ev = await IntegrationEventModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("deskId status").lean<{ deskId: unknown; status: string } | null>();
  if (!ev || !(await ownDesk(auth, String(ev.deskId)))) return notFound("Événement introuvable");
  const body = await req.json().catch(() => ({}));
  if (body.action === "replay") {
    const r = await replayEvent(auth, params.id);
    await logAudit(auth, "UPDATE", "easypay_event", { metadata: { eventId: params.id, replay: r.status } });
    return ok(r);
  }
  if (body.action === "ignore") {
    const r = await IntegrationEventModel.updateOne({ _id: params.id, status: { $in: ["failed", "rejected"] } },
      { $set: { status: "ignored", error: `Écarté${body.note ? ` : ${String(body.note).slice(0, 200)}` : ""}` } });
    if (r.modifiedCount !== 1) return badRequest("Seul un événement en échec ou illisible s'écarte.");
    await logAudit(auth, "UPDATE", "easypay_event", { metadata: { eventId: params.id, ignored: true } });
    return ok({ status: "ignored" });
  }
  return badRequest("Action inconnue.");
});
