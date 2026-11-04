import { NextRequest } from "next/server";
import { SupplierModel } from "@/models/Supplier";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { notifyRoles } from "@/lib/notify";
import { priceAlertsAfterCost } from "@/lib/restaurant-overview";
import { receiveControlled, type ReceptionControl } from "@/lib/restaurant-hygiene";
import { restaurantStock, reserveMoves, moveBetweenLevels, ensureLinked, reserveLoss } from "@/lib/restaurant-stock";

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
  // Noms des fournisseurs : qui reçoit doit pouvoir les choisir, même sans accès à leur fiche.
  const suppliers = await SupplierModel.find({ tenantId: auth.tenantId }).select("name").sort({ name: 1 }).limit(500).lean();
  return ok({ ...stock, showCosts: costs, suppliers, moves: costs ? moves : moves.map(m => ({ ...m, unitCost: undefined })) });
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
      // Contrôle à réception (HACCP) : vérifié d'abord ; une ligne refusée n'entre pas en stock.
      const control: ReceptionControl | null = body.control && typeof body.control === "object" ? {
        chain: String(body.control.chain ?? "ambient"), temperature: body.control.temperature === "" || body.control.temperature === null || body.control.temperature === undefined ? null : Number(body.control.temperature),
        packagingOk: body.control.packagingOk !== false, datesOk: body.control.datesOk !== false, note: typeof body.control.note === "string" ? body.control.note : undefined,
      } : null;
      // Le coût d'achat met à jour le CMUP : réservé à qui voit les coûts.
      const costs = canSeeDeskCosts(auth);
      const res = await receiveControlled(auth, body.deskId, costs ? lines : lines.map((l: Record<string, unknown>) => ({ ...l, unitCost: undefined, packCost: undefined })), {
        supplier: typeof body.supplier === "string" ? body.supplier.slice(0, 120) : undefined,
        supplierId: typeof body.supplierId === "string" ? body.supplierId : undefined,
        reference: typeof body.reference === "string" ? body.reference.slice(0, 60) : undefined,
        paidFromCash: costs && body.paidFromCash === true, method: typeof body.method === "string" ? body.method : undefined,
        dueDays: Number(body.dueDays) >= 0 && Number(body.dueDays) <= 365 ? Math.round(Number(body.dueDays)) : undefined,
        date: typeof body.date === "string" ? body.date : undefined,
      }, control);
      const accepted = res.accepted;
      if (!res.received) {
        await logAudit(auth, "CREATE", "comptoir", { metadata: { reserveReceiveRefused: lines.length } });
        return created({ total: 0, unvalued: 0, alerts: [], belowMinimum: [], control: res.control });
      }
      const r = res.received;
      if (r.alerts.length) {
        await notifyRoles(auth.tenantId, ["pme_admin", "pme_manager", "pme_accountant", "svc_compta"], {
          type: "stock_alert", title: "Hausse du coût d'achat",
          message: r.alerts.map(a => `${a.name} : +${a.pct} % (${Math.round(a.before)} → ${Math.round(a.after)} FCFA)${a.dishes.length ? `, touche ${a.dishes.slice(0, 4).join(", ")}` : ""}`).join(" • "),
          linkedTo: "comptoir", linkedId: String(body.deskId),
        }).catch(() => undefined);
      }
      // Prix de vente devenus trop bas avec le nouveau coût : prix conseillé pour garder la marge nette visée.
      const below = await priceAlertsAfterCost(auth.tenantId, body.deskId, accepted.map((l: { itemId: string }) => String(l.itemId))).catch(() => []);
      if (below.length) {
        await notifyRoles(auth.tenantId, ["pme_admin", "pme_manager", "pme_accountant", "svc_compta", "svc_spot"], {
          type: "stock_alert", title: "Prix de vente sous le minimum après une hausse d'achat",
          message: below.slice(0, 6).map(b => `${b.name} : ${Math.round(b.priceTTC)} FCFA, conseillé ${b.minPriceTTC} FCFA`).join(" • ") + " (Restauration → Prix et marges)",
          linkedTo: "comptoir", linkedId: String(body.deskId),
        }).catch(() => undefined);
      }
      const h = res.control;
      await logAudit(auth, "CREATE", "comptoir", { metadata: { reserveReceive: accepted.length, refused: lines.length - accepted.length, total: r.total } });
      return created({ ...r, belowMinimum: below, ...(h ? { control: h } : {}) });
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
