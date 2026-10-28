import { Error as MongooseError } from "mongoose";
import { ProjectModel } from "@/models/Project";
import { projectScope } from "@/lib/project-scope";
import { BusinessRuleError } from "@/lib/errors";
import type { TokenPayload } from "@/lib/auth";

type ProjectDoc = InstanceType<typeof ProjectModel>;

/**
 * Modifie UN élément d'un projet (une tâche, un jalon) sur la version la
 * plus récente : relecture, modification, enregistrement. Une modification
 * concurrente (version de document changée) fait recommencer, trois fois au
 * plus. L'écran envoyait la liste entière des tâches : deux personnes qui
 * cochaient chacune une tâche s'écrasaient.
 */
export async function mutateProject<T>(auth: TokenPayload, projectId: string, fn: (p: ProjectDoc) => T | Promise<T>): Promise<{ project: ProjectDoc; result: T }> {
  for (let attempt = 0; ; attempt++) {
    const project = await ProjectModel.findOne({ _id: projectId, tenantId: auth.tenantId, deletedAt: { $exists: false }, ...projectScope(auth) });
    if (!project) throw new BusinessRuleError("Projet introuvable.");
    const result = await fn(project);
    try {
      // Les modifications d'éléments de tableau incrémentent la version : un
      // enregistrement fait sur une version périmée échoue (VersionError).
      project.increment();
      await project.save();
      return { project, result };
    } catch (err) {
      if (err instanceof MongooseError.VersionError && attempt < 2) continue;
      throw err;
    }
  }
}

export const TASK_STATUSES = ["todo", "in_progress", "done", "blocked"];

/** Champs d'une tâche acceptés depuis l'écran. */
export function taskFields(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if ("label" in body) { const l = String(body.label ?? "").trim().slice(0, 200); if (!l) throw new BusinessRuleError("Libellé de tâche obligatoire."); out.label = l; }
  if ("status" in body) { if (!TASK_STATUSES.includes(String(body.status))) throw new BusinessRuleError("Statut de tâche inconnu."); out.status = body.status; }
  if ("weight" in body) { const w = Number(body.weight); if (!(w > 0 && w <= 100)) throw new BusinessRuleError("Poids invalide (1 à 100)."); out.weight = w; }
  if ("dueDate" in body) out.dueDate = body.dueDate ? new Date(String(body.dueDate)) : undefined;
  for (const k of ["assigneeId", "memberId", "bureauMemberId"]) if (k in body) out[k] = body[k] || undefined;
  return out;
}
