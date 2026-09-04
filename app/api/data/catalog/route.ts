import { NextRequest } from "next/server";
import { withAuth, ok } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { effectiveRoles, rolesCanPerform } from "@/lib/role-resources";
import { UserRole } from "@/types";
import { ENTITIES } from "@/lib/data-io";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/catalog — pour chaque entité, dit si l'utilisateur peut
 * l'exporter (droit `read`) et l'importer (droit `create`), selon son ou ses
 * rôles. L'écran d'import/export n'affiche que ce qui est permis.
 */
export const GET = withAuth("agenda", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const roles = effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined);
  const catalog = Object.values(ENTITIES).map((e) => ({
    key: e.key,
    label: e.label,
    canExport: rolesCanPerform(roles, e.resource, "read", auth.allowedResources),
    canImport: Boolean(e.import) && rolesCanPerform(roles, e.resource, "create", auth.allowedResources),
    importable: Boolean(e.import),
    columns: e.columns.map((c) => c.header),
  }));
  return ok(catalog);
});
