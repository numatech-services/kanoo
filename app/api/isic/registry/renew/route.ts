import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { IsicLicenseModel } from "@/models/IsicLicense";
import { IsicStudentModel } from "@/models/IsicStudent";
import { isAcademicYear, shiftAcademicYear, defaultValidUntil } from "@/lib/isic-registry";
import { ensureRegistryIndexes } from "@/lib/isic-registry-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/isic/registry/renew — { toYear, studentIds? , school? }
 * Ouvre la licence de l'année `toYear` en gardant le numéro de l'étudiant.
 * Sans `studentIds` : tous les étudiants couverts l'année précédente et pas
 * encore renouvelés (optionnellement pour un établissement).
 */
export const POST = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  await ensureRegistryIndexes();
  const tf = tenantFilter(auth);
  const b = await req.json().catch(() => ({}));
  if (!isAcademicYear(b.toYear)) return badRequest("Année de renouvellement invalide (format 2025-2026).");
  const toYear: string = b.toYear;

  let ids: string[];
  if (Array.isArray(b.studentIds) && b.studentIds.length) {
    ids = (b.studentIds as unknown[]).map(String).filter(id => Types.ObjectId.isValid(id)).slice(0, 20000);
  } else {
    const prev = await IsicLicenseModel.distinct("studentId", { ...tf, status: "active", academicYear: shiftAcademicYear(toYear, -1) });
    ids = prev.map(String);
  }
  // Seulement des étudiants de l'organisation, actifs, éventuellement d'un établissement.
  const sFilter: Record<string, unknown> = { ...tf, archived: { $ne: true }, _id: { $in: ids } };
  if (b.school) sFilter.schoolName = String(b.school);
  const valid = await IsicStudentModel.find(sFilter).select("_id").lean<Array<{ _id: Types.ObjectId }>>();
  if (!valid.length) return ok({ renewed: 0, alreadyCovered: 0 });

  const r = await IsicLicenseModel.bulkWrite(valid.map(s => ({
    updateOne: {
      filter: { tenantId: auth.tenantId, studentId: s._id, academicYear: toYear },
      update: { $setOnInsert: {
        tenantId: auth.tenantId, studentId: s._id, academicYear: toYear,
        validUntil: defaultValidUntil(toYear), source: "renouvellement", status: "active", createdBy: auth.userId,
      } },
      upsert: true,
    },
  })), { ordered: false });

  await logAudit(auth, "UPDATE", "isic", { metadata: { registryRenew: toYear, renewed: r.upsertedCount } });
  return ok({ renewed: r.upsertedCount, alreadyCovered: valid.length - r.upsertedCount });
});
