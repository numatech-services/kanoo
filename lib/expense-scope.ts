import { TokenPayload } from "@/lib/auth";
import { UserModel } from "@/models/User";
import { EmployeeModel } from "@/models/Employee";
import { canPerformAction, effectiveRoles, hasFinanceAccess, isServiceRole } from "@/lib/role-resources";
import { UserRole } from "@/types";

/**
 * Qui voit et valide quelles notes de frais :
 *  - « all »  : gérant, comptabilité (et anciens rôles qui validaient déjà) ;
 *  - « team » : chef de service — les notes des membres de son ou ses services ;
 *  - « own »  : tous les autres — leurs propres notes.
 * Le remboursement reste réservé à la comptabilité et au gérant.
 */
export type ExpenseAuthority = { kind: "all" } | { kind: "team"; services: string[] } | { kind: "own" };

export function expenseAuthority(auth: TokenPayload): ExpenseAuthority {
  const roles = effectiveRoles(auth.role, auth.roles);
  const levels = auth.roleLevels ?? {};
  const teamServices: string[] = [];
  for (const r of roles) {
    if (!canPerformAction(r as UserRole, "expenses", "approve", auth.allowedResources, levels[r])) continue;
    if (!isServiceRole(r) || r === "svc_compta") return { kind: "all" };
    teamServices.push(r);
  }
  return teamServices.length ? { kind: "team", services: teamServices } : { kind: "own" };
}

export function canReimburse(auth: TokenPayload): boolean {
  return hasFinanceAccess(auth) && expenseAuthority(auth).kind === "all";
}

/** Comptes et fiches salariés des membres des services donnés. */
export async function teamMembers(auth: TokenPayload, services: string[]) {
  const users = await UserModel.find({
    tenantId: auth.tenantId,
    $or: [{ role: { $in: services } }, { roles: { $in: services } }],
  }).select("_id").lean<Array<{ _id: unknown }>>();
  const userIds = users.map(u => String(u._id));
  const employees = await EmployeeModel.find({ tenantId: auth.tenantId, userId: { $in: userIds } })
    .select("_id").lean<Array<{ _id: unknown }>>();
  return { userIds, employeeIds: employees.map(e => String(e._id)) };
}
