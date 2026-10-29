import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { effectiveRoles, rolesCanPerform, isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { UserRole } from "@/types";
import { ENTITIES, toCSV } from "@/lib/data-io";
import { canSeePayroll, PAYROLL_FIELDS } from "@/lib/payroll-mask";
import { todayLocal } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/[entity]/export — exporte en CSV les enregistrements de
 * l'organisation. Nécessite le droit `read` sur la ressource de l'entité :
 * un rôle qui ne peut pas lire les clients ne peut pas les exporter.
 */
export const GET = withAuth("agenda", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const entity = ENTITIES[params.entity];
  if (!entity) return notFound("Type de données inconnu.");

  const roles = effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined);
  if (!rolesCanPerform(roles, entity.resource, "read", auth.allowedResources, auth.roleLevels)) {
    return forbidden(`Vous n'avez pas le droit d'exporter « ${entity.label} ».`);
  }
  if (isInternFor(auth, entity.resource)) return forbidden(INTERN_EXPORT_MESSAGE);

  await connectDB();
  let q = entity.model.find(tenantFilter(auth));
  if (entity.populate) for (const [path, select] of entity.populate) q = q.populate(path, select);
  if (entity.sort) q = q.sort(entity.sort);
  const docs = await q.limit(50000).lean();

  // Rémunération exclue de l'export pour qui n'a pas accès à la paie.
  const hidden = new Set<string>(entity.resource === "employees" && !canSeePayroll(auth) ? PAYROLL_FIELDS : []);
  const columns = entity.columns.filter((c) => !hidden.has(c.header));
  const headers = columns.map((c) => c.header);
  const rows = docs.map((d: unknown) => columns.map((c) => c.get(d)));
  const csv = toCSV(headers, rows);

  const stamp = todayLocal();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${entity.key}-${stamp}.csv"`,
    },
  });
});
