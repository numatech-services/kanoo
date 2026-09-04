import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { effectiveRoles, rolesCanPerform } from "@/lib/role-resources";
import { UserRole } from "@/types";
import { ENTITIES, toCSV } from "@/lib/data-io";

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
  if (!rolesCanPerform(roles, entity.resource, "read", auth.allowedResources)) {
    return forbidden(`Vous n'avez pas le droit d'exporter « ${entity.label} ».`);
  }

  await connectDB();
  let q = entity.model.find(tenantFilter(auth));
  if (entity.populate) for (const [path, select] of entity.populate) q = q.populate(path, select);
  if (entity.sort) q = q.sort(entity.sort);
  const docs = await q.limit(50000).lean();

  const headers = entity.columns.map((c) => c.header);
  const rows = docs.map((d: unknown) => entity.columns.map((c) => c.get(d)));
  const csv = toCSV(headers, rows);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${entity.key}-${stamp}.csv"`,
    },
  });
});
