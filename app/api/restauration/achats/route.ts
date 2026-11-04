import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { priceHistory, toInvoice, markInvoiced } from "@/lib/restaurant-purchasing";
import { paySupplier, returnToSupplier, supplierBalances, purchaseLines, valueReception } from "@/lib/restaurant-payables";
import { hasFinanceAccess } from "@/lib/role-resources";

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
  const url = new URL(req.url), lines = url.searchParams.get("lines");
  if (lines) return isId(lines) ? ok(await purchaseLines(auth.tenantId, deskId, lines)) : badRequest("Facture invalide.");
  const [prices, pending, payables] = await Promise.all([priceHistory(auth.tenantId, deskId), toInvoice(auth.tenantId, deskId), supplierBalances(auth.tenantId, deskId)]);
  return ok({ prices, ...pending, payables });
});

/**
 * POST { deskId, ids, invoiceRef } — rapproche des réceptions de la facture du fournisseur ;
 * { action: "pay", purchaseId, amount?, treasuryAccountId? } — règle une facture (caisse du site par défaut) ;
 * { action: "return", purchaseId, lines, reason, reference? } — retour au fournisseur et avoir ;
 * { action: "value", ids, unitCost } — valorise des réceptions reçues sans prix.
 */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden("Rapprochement réservé au chef du comptoir, à la direction et à la comptabilité.");
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  try {
    if (body.action === "pay" || body.action === "return") {
      if (!isId(body.purchaseId)) return badRequest("Facture invalide.");
      if (body.action === "pay") {
        // Hors direction et comptabilité : seulement la caisse du site.
        const r = await paySupplier(auth, body.deskId, body.purchaseId, { amount: body.amount === undefined || body.amount === "" ? undefined : Number(body.amount), treasuryAccountId: hasFinanceAccess(auth) && isId(body.treasuryAccountId) ? body.treasuryAccountId : undefined });
        await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { supplierPaid: r.amount, purchase: body.purchaseId } });
        return ok(r);
      }
      const r = await returnToSupplier(auth, body.deskId, body.purchaseId, { lines: Array.isArray(body.lines) ? body.lines : [], reason: body.reason, reference: typeof body.reference === "string" ? body.reference : undefined });
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { supplierReturn: r.amount, purchase: body.purchaseId } });
      return ok(r);
    }
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter(isId).slice(0, 500);
    if (!ids.length) return badRequest("Aucune réception choisie.");
    if (body.action === "value") {
      const r = await valueReception(auth, body.deskId, ids, Number(body.unitCost));
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { receptionsValued: r.count, total: r.total } });
      return ok(r);
    }
    const r = await markInvoiced(auth, body.deskId, ids, body.invoiceRef);
    await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { invoiced: body.invoiceRef, receptions: r.matched } });
    return ok(r);
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
