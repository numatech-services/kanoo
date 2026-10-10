import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { purgeRegistryStudents } from "@/lib/isic-registry-server";

export const dynamic = "force-dynamic";

/**
 * POST { studentIds } — suppression définitive d'un lot de fiches saisies par
 * erreur (mauvais import, doublons), 500 au plus par appel.
 */
export const POST = withAuth("isic", "delete", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.studentIds) ? [...new Set((body.studentIds as unknown[]).map(String))] : [];
  if (!ids.length) return badRequest("Aucun étudiant sélectionné.");
  if (ids.length > 500) return badRequest("500 fiches au plus par suppression.");
  const r = await purgeRegistryStudents(auth.tenantId, ids);
  await logAudit(auth, "DELETE", "isic", { metadata: { registry: "students-purged", count: r.deleted, licenses: r.licenses, names: r.names.slice(0, 50) } });
  return ok({ deleted: r.deleted, licenses: r.licenses });
});
