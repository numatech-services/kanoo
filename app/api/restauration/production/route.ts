import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { localDay } from "@/lib/format";
import { dayPlan, saveMenu, issueForDay, closeService, SERVICES, type ServiceKey } from "@/lib/restaurant-production";

export const dynamic = "force-dynamic";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * GET ?deskId=&day= — production d'un jour (demain par défaut) : prévision,
 * menus des services, ingrédients à monter de la réserve et à acheter, coût
 * du menu (coûts : chef du comptoir et finance), fins de service.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const day = isDay(url.searchParams.get("day")) ? url.searchParams.get("day")! : localDay(new Date(Date.now() + 86_400_000));
  return ok(await dayPlan(auth.tenantId, deskId, day, canSeeDeskCosts(auth)));
});

/**
 * POST { deskId, day, action, … }
 *  - menu : { service, lines: [{ itemId, quantity }], note? } — menu d'un service ;
 *  - issue : bon de sortie de la réserve pour le plan du jour ;
 *  - close : { service, lines: [{ itemId, produced, leftover }] } — fin de service, restes en perte.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  if (!isDay(body.day)) return badRequest("Jour invalide (AAAA-MM-JJ).");
  const service = (Object.keys(SERVICES).includes(body.service) ? body.service : "midi") as ServiceKey;
  const lines = Array.isArray(body.lines) ? body.lines.filter((l: { itemId?: unknown }) => isId(l?.itemId)).slice(0, 200) : [];
  try {
    if (body.action === "menu") {
      await saveMenu(auth, body.deskId, body.day, service, lines, typeof body.note === "string" ? body.note : undefined);
      return ok({ saved: true });
    }
    if (body.action === "issue") {
      const r = await issueForDay(auth, body.deskId, body.day);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { issue: r.reference, day: body.day } });
      return ok(r);
    }
    if (body.action === "close") {
      const r = await closeService(auth, body.deskId, body.day, service, lines);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { closeService: `${body.day} ${service}`, leftoverValue: r.leftoverValue } });
      return ok(canSeeDeskCosts(auth) ? r : { lines: r.lines });
    }
    return badRequest("Action inconnue (menu, issue, close).");
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
