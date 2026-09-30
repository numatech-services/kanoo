import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ProjectModel } from "@/models/Project";
import { ActivityModel } from "@/models/Activity";
import { authCan } from "@/lib/role-resources";
import { COST_CENTERS } from "@/lib/imputation";

export const dynamic = "force-dynamic";

/**
 * GET /api/imputation/options — listes pour les champs d'imputation des
 * formulaires (dépenses, notes de frais, commandes, charges, écritures) :
 * projets en cours, secteurs d'activité, services. Noms seulement, sans montant.
 */
export const GET = withAuth("agenda", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const tf = tenantFilter(auth);
  const [projects, activities] = await Promise.all([
    authCan(auth, "projects", "read")
      ? ProjectModel.find({ ...tf, status: { $nin: ["cancelled", "archived"] } }).select("code name status").sort({ code: 1 }).limit(500).lean()
      : Promise.resolve([]),
    ActivityModel.find({ ...tf }).select("name color").sort({ name: 1 }).lean(),
  ]);
  return ok({
    projects,
    activities,
    costCenters: Object.entries(COST_CENTERS).map(([value, label]) => ({ value, label })),
  });
});
