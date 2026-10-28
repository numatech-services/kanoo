import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, noContent, notFound, badRequest } from "@/lib/api-helpers";
import { TimeEntryModel } from "@/models/TimeEntry";
import { authCan } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/** DELETE — retire un temps saisi (le sien, ou n'importe lequel pour qui modifie le projet). Pas un temps déjà facturé. */
export const DELETE = withAuth("projects", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.entryId)) return notFound();
  const e = await TimeEntryModel.findOne({ _id: params.entryId, tenantId: auth.tenantId, projectId: params.id }).lean<{ _id: unknown; userId: unknown; invoiceId?: unknown; hours: number } | null>();
  if (!e) return notFound("Temps introuvable");
  if (String(e.userId) !== auth.userId && !authCan(auth, "projects", "update")) return badRequest("Vous ne pouvez retirer que votre propre temps.");
  if (e.invoiceId) return badRequest("Temps déjà facturé.");
  await TimeEntryModel.deleteOne({ _id: e._id });
  await logAudit(auth, "DELETE", "projects", { resourceId: params.id, metadata: { time: e.hours } });
  return noContent();
});
