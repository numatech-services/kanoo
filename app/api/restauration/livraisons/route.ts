import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { localDay } from "@/lib/format";
import { standingDay, saveStanding, confirmStanding, payStanding, startGasBottle, takeBackStanding } from "@/lib/restaurant-standing";
import { ActivityDeskModel } from "@/models/ActivityDesk";

export const dynamic = "force-dynamic";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * GET ?deskId=&day= — livraisons permanentes du jour (attendu, reçu, payé ;
 * montants pour qui voit les coûts) ; &setup=1 — leur réglage (coûts).
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url), deskId = url.searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  if (url.searchParams.get("setup") === "1") {
    if (!canSeeDeskCosts(auth)) return forbidden("Réglage réservé au chef du comptoir, à la gérance et à la comptabilité.");
    const d = await ActivityDeskModel.findOne({ _id: deskId, tenantId: auth.tenantId }).select("standingDeliveries").lean<{ standingDeliveries?: unknown[] } | null>();
    return ok(d?.standingDeliveries ?? []);
  }
  const day = isDay(url.searchParams.get("day")) ? url.searchParams.get("day")! : localDay(new Date());
  try { return ok(await standingDay(auth.tenantId, deskId, day, canSeeDeskCosts(auth))); }
  catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});

/**
 * POST { deskId, action, … }
 *  - setup : { deliveries: [...] } — livraisons permanentes (chef, gérance, comptabilité) ;
 *  - confirm : { id, day, quantity? } — livraison du jour reçue (le matin) ;
 *  - takeback : { id, day, quantity } — invendus repris par le fournisseur (le soir, avant le paiement) ;
 *  - pay : { id, day, method? } — payée depuis la caisse (le soir) ;
 *  - gas : — bouteille de gaz mise en service.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  try {
    if (body.action === "setup") {
      if (!canSeeDeskCosts(auth)) return forbidden("Réglage réservé au chef du comptoir, à la gérance et à la comptabilité.");
      await saveStanding(auth, body.deskId, body.deliveries);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { standingDeliveries: Array.isArray(body.deliveries) ? body.deliveries.length : 0 } });
      return ok({ saved: true });
    }
    if (body.action === "gas") { await startGasBottle(auth, body.deskId); return ok({ saved: true }); }
    if (!isId(body.id) || !isDay(body.day)) return badRequest("Livraison ou jour invalide.");
    if (body.action === "confirm") {
      const r = await confirmStanding(auth, body.deskId, body.id, body.day, body.quantity === undefined || body.quantity === "" ? undefined : Number(body.quantity));
      await logAudit(auth, "CREATE", "comptoir", { resourceId: body.deskId, metadata: { standingReceived: r.reference, quantity: r.quantity } });
      return ok(r);
    }
    if (body.action === "takeback") {
      if (!canSeeDeskCosts(auth) && !authCan(auth, "comptoir", "update")) return forbidden("La reprise des invendus revient au responsable du comptoir.");
      const r = await takeBackStanding(auth, body.deskId, body.id, body.day, Number(body.quantity));
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { standingTakenBack: r.reference, quantity: r.quantity, amount: r.amount } });
      return ok(canSeeDeskCosts(auth) ? r : { reference: r.reference, quantity: r.quantity });
    }
    if (body.action === "pay") {
      // Sortie de caisse : qui encaisse au comptoir (droit de modifier le comptoir) ou qui voit les coûts.
      if (!canSeeDeskCosts(auth) && !authCan(auth, "comptoir", "update")) return forbidden("Le paiement depuis la caisse revient au responsable du comptoir.");
      const r = await payStanding(auth, body.deskId, body.id, body.day, typeof body.method === "string" ? body.method : "cash");
      await logAudit(auth, "CREATE", "comptoir", { resourceId: body.deskId, metadata: { standingPaid: r.reference, total: r.total } });
      return ok(r);
    }
    return badRequest("Action inconnue (setup, confirm, takeback, pay, gas).");
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
