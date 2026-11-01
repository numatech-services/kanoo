import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan, hasFinanceAccess } from "@/lib/role-resources";
import { allDesks, isId } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { restartReport, archiveForRestart, openSite, openingStock, type OpeningInput } from "@/lib/restaurant-opening";
import { EmployeeModel } from "@/models/Employee";
import { UserModel } from "@/models/User";

export const dynamic = "force-dynamic";
const allowed = (auth: TokenPayload) => allDesks(auth) && hasFinanceAccess(auth);
const NO = "Ouverture et archivage des sites : direction et comptabilité.";

/** GET — état des sites actuels (avant un nouveau départ), personnel et comptes disponibles pour un nouveau site. */
export const GET = withAuth("comptoir", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!allowed(auth)) return forbidden(NO);
  const [sites, employees, users] = await Promise.all([
    restartReport(auth.tenantId),
    EmployeeModel.find({ tenantId: auth.tenantId, isActive: true }).select("firstName lastName position").sort({ lastName: 1 }).limit(300).lean(),
    authCan(auth, "users", "update") ? UserModel.find({ tenantId: auth.tenantId, isActive: true }).select("firstName lastName email role").sort({ lastName: 1 }).limit(300).lean() : Promise.resolve(null),
  ]);
  return ok({ sites, employees, users });
});

/**
 * POST { action: "archive", deskIds, solderStock, confirm: "ARCHIVER" } — nouveau départ : sites archivés (rien n'est supprimé) ;
 * POST { action: "open", site: OpeningInput } — ouverture d'un site (caisse et montant de départ, personnel, charges prévues, stock d'ouverture) ;
 * POST { action: "stock", deskId, items } — stock d'ouverture ajouté à un site existant.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!allowed(auth)) return forbidden(NO);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "archive") {
      if (body.confirm !== "ARCHIVER") return badRequest("Confirmation manquante : tapez ARCHIVER.");
      const ids = Array.isArray(body.deskIds) ? body.deskIds.filter(isId) : [];
      if (!ids.length) return badRequest("Aucun site choisi.");
      const r = await archiveForRestart(auth, ids, body.solderStock === true);
      await logAudit(auth, "UPDATE", "comptoir", { metadata: { restartArchive: ids, solderStock: body.solderStock === true } });
      return ok(r);
    }
    if (body.action === "open") {
      const r = await openSite(auth, body.site as OpeningInput, authCan(auth, "users", "update"));
      await logAudit(auth, "CREATE", "comptoir", { resourceId: r.deskId, metadata: { openSite: r.name, stockValue: r.stockValue } });
      return created(r);
    }
    if (body.action === "stock") {
      if (!isId(body.deskId)) return badRequest("Site invalide.");
      const r = await openingStock(auth, body.deskId, Array.isArray(body.items) ? body.items : []);
      await logAudit(auth, "CREATE", "comptoir", { resourceId: body.deskId, metadata: { openingStock: r.items, value: r.stockValue } });
      return created(r);
    }
    return badRequest("Action inconnue (archive, open, stock).");
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
