import type { ClientSession, Types } from "mongoose";
import { ProjectModel } from "@/models/Project";

/**
 * Projet d'exécution d'un marché : c'est lui qui reçoit les dépenses imputées
 * (achats, commandes, notes de frais, charges, écritures) et les recettes.
 */
export async function createExecutionProject(
  tenantId: string,
  contract: { _id: Types.ObjectId; reference: string; title: string; clientId?: unknown; amount: number; startDate?: Date; endDate?: Date },
  managerId: string,
  session?: ClientSession,
) {
  let code = `MCH-${contract.reference}`.slice(0, 40);
  for (let i = 2; await ProjectModel.exists({ tenantId, code }).session(session ?? null); i++) code = `MCH-${contract.reference}-${i}`.slice(0, 40);
  const [project] = await ProjectModel.create([{
    tenantId, code, name: contract.title, projectType: "client",
    ...(contract.clientId ? { clientId: contract.clientId } : {}),
    managerId, contractIds: [contract._id],
    ...(contract.startDate ? { startDate: contract.startDate } : {}), ...(contract.endDate ? { endDate: contract.endDate } : {}),
    description: `Exécution du marché ${contract.reference}`,
  }], { session });
  return project;
}
