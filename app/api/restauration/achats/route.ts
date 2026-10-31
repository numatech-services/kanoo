import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { priceHistory, toInvoice, markInvoiced } from "@/lib/restaurant-purchasing";

export const dynamic = "force-dynamic";

/**
 * GET ?deskId= — achats d'un restaurant : historique et comparaison des prix
 * d'achat par article et par fournisseur (90 jours), réceptions et commandes
 * reçues sans facture. Chef du comptoir, direction, comptabilité.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden("Prix d'achat réservés au chef du comptoir, à la direction et à la comptabilité.");
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const [prices, pending] = await Promise.all([priceHistory(auth.tenantId, deskId), toInvoice(auth.tenantId, deskId)]);
  return ok({ prices, ...pending });
});

/** POST { deskId, ids, invoiceRef } — rapproche des réceptions de la facture du fournisseur. */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden("Rapprochement réservé au chef du comptoir, à la direction et à la comptabilité.");
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter(isId).slice(0, 500);
  if (!ids.length) return badRequest("Aucune réception choisie.");
  try {
    const r = await markInvoiced(auth, body.deskId, ids, body.invoiceRef);
    await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { invoiced: body.invoiceRef, receptions: r.matched } });
    return ok(r);
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
