import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { canSeeDeskCosts, deskScope, isId, ownDesk } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { groupedPlan, createGroupedOrders, saveForecastEvent, listForecastEvents } from "@/lib/restaurant-grouped";
import { DeskForecastEventModel } from "@/models/DeskForecastEvent";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { localDay } from "@/lib/format";

export const dynamic = "force-dynamic";
const NO = "Réservé au responsable achats, à la direction et à la comptabilité.";

/** GET — besoins consolidés de tous les sites de l'appelant, et événements de prévision à venir. */
export const GET = withAuth("comptoir", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden(NO);
  const scope = deskScope(auth);
  const desks = await ActivityDeskModel.find({ tenantId: auth.tenantId, archived: { $ne: true }, ...(scope ? { _id: { $in: scope } } : {}) }).select("name").sort({ name: 1 }).lean<Array<{ _id: unknown; name: string }>>();
  const [plan, events] = await Promise.all([groupedPlan(auth.tenantId, desks.map(d => String(d._id))), listForecastEvents(auth.tenantId, localDay(new Date()))]);
  return ok({ ...plan, desks, events });
});

/**
 * POST { action: "orders", lines: [{ deskId, itemId, quantity }] } — bons brouillon par site et fournisseur ;
 * { action: "event", deskIds, from, to, label, factor, note? } — événement de prévision ;
 * { action: "deleteEvent", id }.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden(NO);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "orders") {
      const lines = (Array.isArray(body.lines) ? body.lines : []).filter((l: { deskId?: unknown; itemId?: unknown }) => isId(l?.deskId) && isId(l?.itemId)).slice(0, 500);
      for (const id of new Set<string>(lines.map((l: { deskId: string }) => l.deskId))) if (!(await ownDesk(auth, id))) return forbidden("Site non autorisé.");
      const r = await createGroupedOrders(auth, lines);
      await logAudit(auth, "CREATE", "comptoir", { metadata: { groupedOrders: r.orders } });
      return created(r);
    }
    if (body.action === "event") {
      const deskIds = Array.isArray(body.deskIds) ? body.deskIds.filter(isId) : [];
      for (const id of deskIds) if (!(await ownDesk(auth, id))) return forbidden("Site non autorisé.");
      const e = await saveForecastEvent(auth, { deskIds, from: body.from, to: body.to, label: body.label, factor: Number(body.factor), note: typeof body.note === "string" ? body.note : undefined });
      return created({ _id: String(e._id) });
    }
    if (body.action === "deleteEvent") {
      if (!isId(body.id)) return badRequest("Événement invalide.");
      await DeskForecastEventModel.deleteOne({ _id: body.id, tenantId: auth.tenantId });
      return ok({ deleted: true });
    }
    return badRequest("Action inconnue.");
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
