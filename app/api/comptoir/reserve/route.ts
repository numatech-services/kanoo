import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { notifyRoles } from "@/lib/notify";
import { restaurantStock, reserveMoves, receiveInReserve, moveBetweenLevels, ensureLinked, reserveLoss } from "@/lib/restaurant-stock";

export const dynamic = "force-dynamic";

/**
 * GET /api/comptoir/reserve?deskId= — stock du restaurant à deux niveaux :
 * réserve (en gros) et comptoir (vente), article par article, avec les
 * péremptions proches, les seuils et la quantité à monter au comptoir ; les
 * flux de la réserve. Coûts et valeurs : chef du comptoir et finance seulement.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const costs = canSeeDeskCosts(auth);
  const [stock, moves] = await Promise.all([restaurantStock(auth.tenantId, deskId, costs), reserveMoves(auth.tenantId, deskId, 60)]);
  return ok({ ...stock, moves: costs ? moves : moves.map(m => ({ ...m, unitCost: undefined })) });
});

/**
 * POST — { deskId, action, lines, … }
 *  - receive : réception en réserve { lines: [{ itemId, quantity | packs, unitCost | packCost, lotNumber?, expiryDate? }], supplier?, reference?, paidFromCash?, method? } ;
 *  - supply  : approvisionner le comptoir depuis la réserve { lines: [{ itemId, quantity | packs }] } ;
 *  - return  : retour du comptoir en réserve ;
 *  - loss    : perte constatée en réserve { lines, reason, note? } ;
 *  - link    : relier au catalogue les articles qui ne le sont pas { itemIds }.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const lines = Array.isArray(body.lines) ? body.lines.filter((l: { itemId?: unknown }) => isId(l?.itemId)) : [];
  try {
    if (body.action === "receive") {
      // Le coût d'achat met à jour le CMUP : réservé à qui voit les coûts.
      const costs = canSeeDeskCosts(auth);
      const r = await receiveInReserve(auth, body.deskId, costs ? lines : lines.map((l: Record<string, unknown>) => ({ ...l, unitCost: undefined, packCost: undefined })), {
        supplier: typeof body.supplier === "string" ? body.supplier.slice(0, 120) : undefined,
        reference: typeof body.reference === "string" ? body.reference.slice(0, 60) : undefined,
        paidFromCash: costs && body.paidFromCash === true, method: typeof body.method === "string" ? body.method : undefined,
        date: typeof body.date === "string" ? body.date : undefined,
      });
      if (r.alerts.length) {
        await notifyRoles(auth.tenantId, ["pme_admin", "pme_manager", "pme_accountant", "svc_compta"], {
          type: "stock_alert", title: "Hausse du coût d'achat",
          message: r.alerts.map(a => `${a.name} : +${a.pct} % (${Math.round(a.before)} → ${Math.round(a.after)} FCFA)${a.dishes.length ? `, touche ${a.dishes.slice(0, 4).join(", ")}` : ""}`).join(" • "),
          linkedTo: "comptoir", linkedId: String(body.deskId),
        }).catch(() => undefined);
      }
      await logAudit(auth, "CREATE", "comptoir", { metadata: { reserveReceive: lines.length, total: r.total } });
      return created(r);
    }
    if (body.action === "supply" || body.action === "return") {
      const r = await moveBetweenLevels(auth, body.deskId, lines, body.action);
      await logAudit(auth, "UPDATE", "comptoir", { metadata: { [body.action === "supply" ? "reserveSupply" : "reserveReturn"]: r.reference, lines: lines.length } });
      return created(r);
    }
    if (body.action === "loss") {
      const r = await reserveLoss(auth, body.deskId, lines, String(body.reason ?? ""), typeof body.note === "string" ? body.note : undefined);
      await logAudit(auth, "CREATE", "comptoir", { metadata: { reserveLoss: r.reference, lines: lines.length, value: r.value } });
      return created({ reference: r.reference, value: canSeeDeskCosts(auth) ? r.value : undefined });
    }
    if (body.action === "link") {
      const ids = (Array.isArray(body.itemIds) ? body.itemIds : []).filter(isId).slice(0, 500);
      // Articles de CE comptoir seulement (contrôlé ci-dessus), chacun dans sa transaction.
      for (const id of ids) await withTransaction(session => ensureLinked(auth, body.deskId, id, session));
      return ok({ linked: ids.length });
    }
    return badRequest("Action inconnue (receive, supply, return, loss, link).");
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
