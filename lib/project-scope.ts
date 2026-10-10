import { Types } from "mongoose";
import type { TokenPayload } from "@/lib/auth";
import { bestLevelFor, effectiveRoles } from "@/lib/role-resources";
import type { UserRole } from "@/types";

/**
 * Projets visibles : tous pour un chef de service, la direction ou un rôle
 * hors service ; pour un employé ou un stagiaire de service, ceux qu'il dirige,
 * dont il est membre de l'équipe ou où une tâche lui est confiée. Sans cette
 * borne, chacun lisait et modifiait tous les projets de l'organisation.
 */
export function projectScope(auth: TokenPayload): Record<string, unknown> {
  const roles = effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined);
  const level = bestLevelFor(roles, "projects", "read", auth.allowedResources, auth.roleLevels);
  if (level === null || level === "chef") return {};
  const me = new Types.ObjectId(auth.userId);
  return { $or: [{ managerId: me }, { teamIds: me }, { "tasks.assigneeId": me }] };
}
