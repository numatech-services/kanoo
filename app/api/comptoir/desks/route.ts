import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, conflict, forbidden, tenantFilter, requireFields } from "@/lib/api-helpers";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityModel } from "@/models/Activity";
import { isId, deskScope, allDesks, canSeeDeskCosts } from "@/lib/comptoir";
import { authCan } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";
import { deskWarehouse } from "@/lib/comptoir-stock";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Liste des comptoirs (The Spot et autres points d'activité).
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  // Employé ou stagiaire The Spot : seulement ses sites.
  const scope = deskScope(auth);
  if (scope) filter._id = { $in: scope.filter(isId) };
  filter.archived = url.searchParams.get("archived") === "1" ? true : { $ne: true };
  const items = await ActivityDeskModel.find(filter).sort({ createdAt: 1 }).lean<Array<Record<string, unknown>>>();
  // Budget, objectifs de marge et personnel affecté : pas pour la caisse ; le personnel, pour la paie seulement.
  const costs = canSeeDeskCosts(auth), payroll = authCan(auth, "payslips", "read");
  return ok(items.map(d => {
    const { plannedCosts, targetMarkup, weeklyMarginTarget, commonCostShare, targetNetMargin, staff, ...rest } = d;
    return { ...rest, ...(costs ? { plannedCosts, targetMarkup, weeklyMarginTarget, commonCostShare, targetNetMargin } : {}), ...(payroll ? { staff } : {}) };
  }));
});

// Création d'un comptoir — c'est ainsi qu'on « lance » une activité (The Spot).
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!allDesks(auth)) return forbidden("Seuls le chef The Spot, la comptabilité et le gérant créent un comptoir.");
  const err = requireFields(body, ["name"]);
  if (err) return badRequest(err);
  const name = String(body.name).slice(0, 120).trim();
  if (!name) return badRequest("Le nom est requis.");
  if (await ActivityDeskModel.exists({ ...tenantFilter(auth), name })) {
    return conflict("Un comptoir porte déjà ce nom.");
  }
  // Secteur analytique : accepté seulement s'il appartient à l'organisation.
  let activityId: string | undefined;
  if (body.activityId) {
    if (!isId(body.activityId) || !(await ActivityModel.exists({ _id: body.activityId, ...tenantFilter(auth) }))) {
      return badRequest("Secteur analytique introuvable.");
    }
    if (await ActivityDeskModel.exists({ ...tenantFilter(auth), activityId: body.activityId, archived: { $ne: true } })) return badRequest("Ce secteur analytique est déjà celui d'un autre comptoir : créez un secteur propre à chaque comptoir.");
    activityId = body.activityId;
  }
  const desk = await ActivityDeskModel.create({
    tenantId: auth.tenantId,
    name,
    description: String(body.description || "").slice(0, 400),
    activityId,
    createdBy: auth.userId,
  });
  // Réserve du comptoir dans la gestion de stock (approvisionnement par transfert).
  await deskWarehouse(auth.tenantId, desk._id);
  await logAudit(auth, "CREATE", "comptoir", { resourceId: desk._id.toString(), metadata: { name: desk.name } });
  return created(desk);
});
