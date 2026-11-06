import { Types } from "mongoose";
import type { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { contractScope, marketsOnly } from "@/lib/contract-input";
import { ContractModel } from "@/models/Contract";
import { ExpenseReportModel } from "@/models/ExpenseReport";
import { LeaveModel } from "@/models/Leave";
import { expenseAuthority, teamMembers } from "@/lib/expense-scope";
import { scopeEmployees, ownEmployee } from "@/lib/leave-scope";
import { ProjectModel } from "@/models/Project";
import { projectScope } from "@/lib/project-scope";

/**
 * Qui peut voir / joindre / retirer une pièce, selon le document porteur.
 *
 * Cas général : le droit du document porteur (lire pour voir, modifier pour
 * joindre ou retirer). Notes de frais et congés : documents PERSONNELS —
 * l'auteur joint ses justificatifs avec le seul droit de créer sa note, et
 * seuls l'auteur, son valideur et la comptabilité voient les pièces (avant,
 * tout titulaire du droit de lecture lisait les reçus de tous, et l'auteur
 * ne pouvait pas joindre les siens).
 */
export async function attachmentAccess(auth: TokenPayload, host: string, hostId: unknown, mode: "read" | "write"): Promise<boolean> {
  // Pièces d'un contrat : la comptabilité n'accède qu'à celles des marchés clients.
  if (host === "contracts" && marketsOnly(auth)) {
    if (!Types.ObjectId.isValid(String(hostId)) || !(await ContractModel.exists({ _id: hostId, ...contractScope(auth) }))) return false;
  }
  if (host === "expenses") {
    if (!Types.ObjectId.isValid(String(hostId))) return false;
    const r = await ExpenseReportModel.findOne({ _id: hostId, tenantId: auth.tenantId }).select("createdBy status").lean<{ createdBy: unknown; status: string } | null>();
    if (!r) return false;
    const author = String(r.createdBy) === auth.userId;
    if (mode === "write") {
      return (author && authCan(auth, "expenses", "create") && ["draft", "rejected"].includes(r.status)) || authCan(auth, "expenses", "update");
    }
    if (author || authCan(auth, "expenses", "update")) return true;
    const a = expenseAuthority(auth);
    if (a.kind === "all") return true;
    if (a.kind === "team") return (await teamMembers(auth, a.services)).userIds.includes(String(r.createdBy));
    return false;
  }
  if (host === "leaves") {
    if (!Types.ObjectId.isValid(String(hostId))) return false;
    const l = await LeaveModel.findOne({ _id: hostId, tenantId: auth.tenantId }).select("employeeId createdBy").lean<{ employeeId: unknown; createdBy: unknown } | null>();
    if (!l) return false;
    const own = await ownEmployee(auth);
    const mine = String(l.createdBy) === auth.userId || (own && String(own._id) === String(l.employeeId));
    if (mode === "write") return Boolean(mine) || authCan(auth, "leaves", "update");
    if (mine) return true;
    const scope = await scopeEmployees(auth);
    return scope === null || scope.includes(String(l.employeeId));
  }
  if (host === "projects" && !(await ProjectModel.exists({ _id: hostId, tenantId: auth.tenantId, ...projectScope(auth) }))) return false;
  return mode === "read"
    ? authCan(auth, "documents", "read") && authCan(auth, host, "read")
    : authCan(auth, "documents", "create") && authCan(auth, host, "update");
}
