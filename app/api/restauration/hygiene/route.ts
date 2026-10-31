import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { isId, ownDesk } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { notifyRoles } from "@/lib/notify";
import { localDay } from "@/lib/format";
import { hygieneOverview, saveHygieneSetup, recordTemperature, recordSample, discardSample, recordCleaning, itemLots, traceLot } from "@/lib/restaurant-hygiene";

export const dynamic = "force-dynamic";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const MANAGERS = ["pme_admin", "pme_manager", "pme_activity_manager"];

/**
 * GET ?deskId=&day= — registre d'hygiène du jour (relevés, réceptions, plats
 * témoins, nettoyage, non-conformités des 30 derniers jours) ;
 * &lots=itemId — lots connus d'un ingrédient ; &trace=itemId&lot= — traçabilité d'un lot.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  try {
    const lots = url.searchParams.get("lots"), trace = url.searchParams.get("trace"), lot = url.searchParams.get("lot");
    if (isId(lots)) return ok(await itemLots(auth.tenantId, deskId, lots));
    if (isId(trace) && lot) return ok(await traceLot(auth.tenantId, deskId, trace, lot.slice(0, 80)));
    const day = isDay(url.searchParams.get("day")) ? url.searchParams.get("day")! : localDay(new Date());
    return ok(await hygieneOverview(auth.tenantId, deskId, day));
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});

/**
 * POST { deskId, action, … }
 *  - setup : { coldUnits?, cleaningTasks? } — enceintes et plan de nettoyage (responsable du comptoir) ;
 *  - temperature : { unitId, value, action? } — relevé ; hors limites, les responsables sont prévenus ;
 *  - sample : { itemId, service, day } — plat témoin ; discard : { id } — plat témoin jeté ;
 *  - cleaning : { taskId, note? } — tâche du plan de nettoyage faite.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  try {
    switch (body.action) {
      case "setup":
        if (!authCan(auth, "comptoir", "update")) return forbidden("Le plan d'hygiène se règle par le responsable du comptoir.");
        await saveHygieneSetup(auth, body.deskId, { coldUnits: body.coldUnits, cleaningTasks: body.cleaningTasks });
        await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { hygieneSetup: true } });
        return ok({ saved: true });
      case "temperature": {
        if (!isId(body.unitId)) return badRequest("Enceinte invalide.");
        const r = await recordTemperature(auth, body.deskId, body.unitId, Number(body.value), typeof body.correctiveAction === "string" ? body.correctiveAction : undefined);
        if (!r.ok) await notifyRoles(auth.tenantId, MANAGERS, { type: "stock_alert", title: `Température hors limites — ${r.unit}`, message: `${Number(body.value)} °C relevés (limites : ${r.min ?? "—"} à ${r.max ?? "—"} °C). Vérifiez l'enceinte et les denrées, notez l'action corrective (Restauration → Hygiène).`, linkedTo: "comptoir", linkedId: String(body.deskId) }).catch(() => undefined);
        return ok(r);
      }
      case "sample":
        if (!isId(body.itemId) || !isDay(body.day)) return badRequest("Plat ou jour invalide.");
        await recordSample(auth, body.deskId, body.itemId, String(body.service ?? "midi"), body.day);
        return ok({ saved: true });
      case "discard":
        if (!isId(body.id)) return badRequest("Plat témoin invalide.");
        await discardSample(auth, body.deskId, body.id);
        return ok({ discarded: true });
      case "cleaning":
        if (!isId(body.taskId)) return badRequest("Tâche invalide.");
        await recordCleaning(auth, body.deskId, body.taskId, typeof body.note === "string" ? body.note : undefined);
        return ok({ saved: true });
      default:
        return badRequest("Action inconnue (setup, temperature, sample, discard, cleaning).");
    }
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
