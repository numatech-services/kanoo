import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, forbidden, noContent, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { LeaveModel } from "@/models/Leave";
import { EmployeeModel } from "@/models/Employee";
import { authCan } from "@/lib/role-resources";
import { scopeEmployees } from "@/lib/leave-scope";
import { logAudit } from "@/lib/audit";

/**
 * PATCH { action: "approve" | "reject" | "cancel", note? }
 * Valider / refuser : chef de service (son équipe), Administration, gérant —
 * jamais sa propre demande. Annuler : le demandeur tant que ce n'est pas passé,
 * ou un valideur.
 */
export const PATCH = withAuth("leaves", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const leave = await LeaveModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!leave) return notFound();
  const own = await EmployeeModel.findOne({ tenantId: auth.tenantId, userId: auth.userId }).select("_id").lean<{ _id: unknown } | null>();
  const isMine = !!own && String(own._id) === String(leave.employeeId);
  const allowed = await scopeEmployees(auth);
  const inScope = !allowed || allowed.includes(String(leave.employeeId));
  const canApprove = authCan(auth, "leaves", "approve") && inScope;

  if (body.action === "approve" || body.action === "reject") {
    if (!canApprove) return forbidden("Validation réservée au chef de service, à l'Administration ou au gérant.");
    if (isMine) return forbidden("On ne valide pas sa propre demande.");
    if (leave.status !== "pending") return badRequest("Demande déjà traitée.");
    leave.status = body.action === "approve" ? "approved" : "rejected";
  } else if (body.action === "cancel") {
    if (!isMine && !canApprove) return forbidden("Vous ne pouvez pas annuler cette demande.");
    if (leave.status === "cancelled" || leave.status === "rejected") return badRequest("Demande déjà close.");
    if (isMine && !canApprove && leave.status === "approved" && new Date(leave.startDate) <= new Date()) return badRequest("Congé commencé : demandez l'annulation à votre responsable.");
    leave.status = "cancelled";
  } else {
    return badRequest("Action inconnue.");
  }
  leave.decidedBy = auth.userId;
  leave.decidedAt = new Date();
  if (body.note) leave.decisionNote = String(body.note).slice(0, 500);
  await leave.save();
  await logAudit(auth, "UPDATE", "leaves", { resourceId: params.id, after: { status: leave.status } });
  return ok(leave);
});

/** DELETE — suppression d'une demande en attente (le demandeur) ou par un valideur. */
export const DELETE = withAuth("leaves", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const leave = await LeaveModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!leave) return notFound();
  const own = await EmployeeModel.findOne({ tenantId: auth.tenantId, userId: auth.userId }).select("_id").lean<{ _id: unknown } | null>();
  const isMine = !!own && String(own._id) === String(leave.employeeId);
  if (!(isMine && leave.status === "pending") && !authCan(auth, "leaves", "delete")) return forbidden("Seule une demande en attente se supprime par son auteur.");
  await LeaveModel.deleteOne({ _id: leave._id });
  await logAudit(auth, "DELETE", "leaves", { resourceId: params.id });
  return noContent();
});
