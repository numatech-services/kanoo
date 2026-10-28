import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent } from "@/lib/api-helpers";
import { mutateProject, taskFields } from "@/lib/project-ops";
import { checkProjectRefs } from "@/lib/project-refs";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

type Sub = { _id: unknown; set: (v: Record<string, unknown>) => void; deleteOne: () => void; status?: string; completedAt?: Date };
type Arr = { id: (k: string) => Sub | null };

/** PATCH — modifie UNE tâche (statut, libellé, poids, échéance, personne). */
export const PATCH = withAuth("projects", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const fields = taskFields(await req.json().catch(() => ({})));
  const refErr = await checkProjectRefs(auth.tenantId, { tasks: [fields] });
  if (refErr) throw new BusinessRuleError(refErr);
  const { result } = await mutateProject(auth, params.id, p => {
    const t = (p.tasks as unknown as Arr).id(params.taskId);
    if (!t) throw new BusinessRuleError("Tâche introuvable (supprimée entre-temps ?).");
    if (fields.status === "done" && t.status !== "done") fields.completedAt = new Date();
    if (fields.status && fields.status !== "done") fields.completedAt = undefined;
    t.set(fields);
    return t;
  });
  await logAudit(auth, "UPDATE", "projects", { resourceId: params.id, metadata: { task: params.taskId, ...fields } });
  return ok(result);
});

/** DELETE — retire UNE tâche. */
export const DELETE = withAuth("projects", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  await mutateProject(auth, params.id, p => {
    const t = (p.tasks as unknown as Arr).id(params.taskId);
    if (!t) throw new BusinessRuleError("Tâche introuvable (supprimée entre-temps ?).");
    t.deleteOne();
  });
  await logAudit(auth, "UPDATE", "projects", { resourceId: params.id, metadata: { taskDeleted: params.taskId } });
  return noContent();
});
