import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { AuditLogModel } from "@/models/AuditLog";
import { TokenPayload } from "@/lib/auth";
import { effectiveRoles, accessibleResourcesForRoles } from "@/lib/role-resources";
import { hasTenantAdminRole } from "@/lib/roles-ui";
import { UserRole } from "@/types";

export const GET = withAuth("auditLogs", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const resource = url.searchParams.get("resource");
  const userId = url.searchParams.get("userId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const filter: Record<string, unknown> = auth.role === "superadmin"
    ? {}
    : { ...tenantFilter(auth) };

  // Cloisonnement : hors gérant / comptabilité, le journal se limite aux
  // ressources que le compte lit déjà — un journal de paiements ou de paie
  // expose montants et bénéficiaires (champs before / after).
  // Journal complet : superadmin et administrateurs seulement. Les autres
  // comptes financiers (comptable employé ou stagiaire, gestionnaire, lecteur)
  // voyaient aussi la paie et les comptes utilisateurs (avant / après).
  const readable = auth.role === "superadmin" || hasTenantAdminRole(auth)
    ? null
    : accessibleResourcesForRoles(effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined), auth.allowedResources, auth.roleLevels);
  if (resource) filter.resource = readable && !readable.includes(resource) ? "__aucune__" : resource;
  else if (readable) filter.resource = { $in: readable };
  if (userId) filter.userId = userId;
  if (from || to) {
    filter.createdAt = {};
    if (from) (filter.createdAt as Record<string, unknown>).$gte = new Date(from);
    if (to) (filter.createdAt as Record<string, unknown>).$lte = new Date(to + "T23:59:59");
  }

  const [items, total] = await Promise.all([
    AuditLogModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    AuditLogModel.countDocuments(filter),
  ]);

  return paginatedResponse(items, total, pagination);
});
