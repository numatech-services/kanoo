import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan, hasFinanceAccess } from "@/lib/role-resources";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { isMonth } from "@/lib/restaurant";
import { pilotage, saveBudget, saveAllocation, linkAsset } from "@/lib/restaurant-pilotage";

export const dynamic = "force-dynamic";
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

/**
 * GET ?deskId=&month= — pilotage d'un restaurant : charges fixes et
 * variables, point mort et baisse de volume, budget de l'année contre le
 * réel, équipements et dotations, clé de répartition. Coûts : chef du
 * comptoir, gérance et comptabilité.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden("Pilotage réservé au chef du comptoir, à la gérance et à la comptabilité.");
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const month = url.searchParams.get("month") || thisMonth();
  if (!isMonth(month)) return badRequest("Mois invalide (AAAA-MM).");
  try {
    return ok(await pilotage(auth.tenantId, deskId, month, authCan(auth, "payslips", "read"), hasFinanceAccess(auth)));
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});

/**
 * POST { deskId, action, … }
 *  - budget : { year, revenue: [12], materialPct, charges: [{ category, annual }], note? } ;
 *  - allocation : { shares?: [{ deskId, share }], variableCategories?: [] } ;
 *  - link | unlink : { assetId } — équipement du registre des immobilisations (comptabilité).
 */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden("Pilotage réservé au chef du comptoir, à la gérance et à la comptabilité.");
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  try {
    if (body.action === "budget") {
      await saveBudget(auth, body.deskId, Number(body.year), body);
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { budget: Number(body.year) } });
      return ok({ saved: true });
    }
    if (body.action === "allocation") {
      // La clé du secteur touche aussi les autres comptoirs du secteur : elle revient à qui voit tous les sites.
      if (body.shares !== undefined && !hasFinanceAccess(auth)) return forbidden("La clé de répartition entre restaurants revient à la comptabilité ou à la gérance.");
      const r = await saveAllocation(auth, body.deskId, { shares: body.shares, variableCategories: body.variableCategories });
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { allocation: body.shares ?? null, variableCategories: body.variableCategories ?? null } });
      return ok(r);
    }
    if (body.action === "link" || body.action === "unlink") {
      if (!hasFinanceAccess(auth)) return forbidden("Le rattachement des immobilisations revient à la comptabilité.");
      if (!isId(body.assetId)) return badRequest("Équipement invalide.");
      await linkAsset(auth, body.deskId, body.assetId, body.action === "link");
      await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { [body.action]: body.assetId } });
      return ok({ done: true });
    }
    return badRequest("Action inconnue (budget, allocation, link, unlink).");
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
