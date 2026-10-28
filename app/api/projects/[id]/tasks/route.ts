import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created } from "@/lib/api-helpers";
import { mutateProject, taskFields } from "@/lib/project-ops";
import { checkProjectRefs } from "@/lib/project-refs";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** POST — ajoute une tâche (sans réécrire les autres). */
export const POST = withAuth("projects", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const fields = taskFields({ status: "todo", weight: 1, ...body });
  if (!fields.label) throw new BusinessRuleError("Libellé de tâche obligatoire.");
  const refErr = await checkProjectRefs(auth.tenantId, { tasks: [fields] });
  if (refErr) throw new BusinessRuleError(refErr);
  const { result } = await mutateProject(auth, params.id, p => {
    p.tasks.push(fields);
    return p.tasks[p.tasks.length - 1];
  });
  await logAudit(auth, "UPDATE", "projects", { resourceId: params.id, metadata: { taskAdded: fields.label } });
  return created(result);
});
