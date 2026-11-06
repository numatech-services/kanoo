import { NextRequest } from "next/server";
import { contractScope } from "@/lib/contract-input";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, conflict, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { ContractModel } from "@/models/Contract";
import { ProjectModel } from "@/models/Project";
import { DevisModel } from "@/models/Devis";
import { createExecutionProject } from "@/lib/market-project";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST — { projectId? } : relie le marché à un projet existant, ou crée son
 * projet d'exécution. Les dépenses imputées à ce projet deviennent celles du marché.
 */
export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const contract = await ContractModel.findOne({ _id: params.id, ...contractScope(auth) });
  if (!contract) return notFound("Marché introuvable");
  if (contract.projectId && !body.replace) return conflict("Ce marché a déjà un projet d'exécution.");
  let projectId: unknown;
  if (body.projectId) {
    if (!Types.ObjectId.isValid(String(body.projectId))) return badRequest("Projet invalide.");
    const p = await ProjectModel.findOne({ _id: body.projectId, ...tenantFilter(auth) }).select("_id");
    if (!p) return notFound("Projet introuvable");
    await ProjectModel.updateOne({ _id: p._id }, { $addToSet: { contractIds: contract._id } });
    projectId = p._id;
  } else {
    if (!authCan(auth, "projects", "create")) return forbidden("Créer le projet d'exécution demande le droit de créer des projets.");
    projectId = await withTransaction(async session => (await createExecutionProject(auth.tenantId, contract, auth.userId, session))._id);
  }
  contract.projectId = projectId;
  await contract.save();
  if (contract.devisId) await DevisModel.updateOne({ _id: contract.devisId, ...tenantFilter(auth) }, { $set: { projectId } });
  await logAudit(auth, "UPDATE", "contracts", { resourceId: String(contract._id), after: { projectId: String(projectId) } });
  return ok({ projectId });
});
