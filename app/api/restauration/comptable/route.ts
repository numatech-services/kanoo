import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden, notFound } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { hasFinanceAccess } from "@/lib/role-resources";
import { canSeeDeskCosts, deskScope, isId, ownDesk } from "@/lib/comptoir";
import { journal, evolution, controls, siteBalance, marginTable } from "@/lib/restaurant-accounting";
import { consolidatedStock } from "@/lib/restaurant-opening";
import { ActivityDeskModel } from "@/models/ActivityDesk";

export const dynamic = "force-dynamic";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * GET ?view=journal|evolution|controls|balance|margins|stock
 *   &deskId= (un site, sinon tous ceux de l'appelant) &from=&to= &category=&method= &month=
 * Journal, évolution, contrôles, équilibre, stocks : direction et comptabilité.
 * Marges : aussi le chef du site.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url), view = url.searchParams.get("view") ?? "journal", one = url.searchParams.get("deskId");
  if (view === "margins" ? !canSeeDeskCosts(auth) : !hasFinanceAccess(auth)) return forbidden("Espace réservé à la direction et à la comptabilité.");
  if (one && (!isId(one) || !(await ownDesk(auth, one)))) return notFound("Site introuvable");
  const scope = deskScope(auth);
  const desks = await ActivityDeskModel.find({ tenantId: auth.tenantId, archived: { $ne: true }, ...(scope ? { _id: { $in: scope } } : {}) }).select("name").sort({ name: 1 }).lean<Array<{ _id: unknown; name: string }>>();
  const ids = one ? [one] : desks.map(d => String(d._id));
  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  switch (view) {
    case "journal":
      if (!isDay(from) || !isDay(to) || to < from) return badRequest("Période invalide.");
      return ok({ desks, ...(await journal(auth.tenantId, ids, from, to, { category: url.searchParams.get("category") ?? undefined, method: url.searchParams.get("method") ?? undefined })) });
    case "evolution":
      if (!isDay(from) || !isDay(to) || to < from) return badRequest("Période invalide.");
      return ok(await evolution(auth.tenantId, ids, from, to));
    case "controls": return ok(await controls(auth.tenantId, ids));
    case "balance": return ok((await Promise.all(ids.map(id => siteBalance(auth.tenantId, id)))).filter(Boolean));
    case "stock": return ok(await consolidatedStock(auth.tenantId));
    case "margins": {
      const month = url.searchParams.get("month") ?? "";
      if (!/^\d{4}-\d{2}$/.test(month) || !one) return badRequest("Choisissez un site et un mois.");
      return ok(await marginTable(auth.tenantId, one, month));
    }
    default: return badRequest("Vue inconnue.");
  }
});
