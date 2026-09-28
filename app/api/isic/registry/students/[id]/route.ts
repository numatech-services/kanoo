import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, conflict, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicLicenseModel } from "@/models/IsicLicense";
import { IsicCardModel } from "@/models/IsicCard";
import {
  studentKey, normalizeIsicNumber, isPlausibleIsicNumber, isAcademicYear, defaultValidUntil,
} from "@/lib/isic-registry";
import { ensureRegistryIndexes } from "@/lib/isic-registry-server";

export const dynamic = "force-dynamic";

/** GET — fiche complète : identité, numéro, historique, licences, cartes produites. */
export const GET = withAuth("isic", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Étudiant introuvable");
  const tf = tenantFilter(auth);
  const student = await IsicStudentModel.findOne({ _id: params.id, ...tf }).lean();
  if (!student) return notFound("Étudiant introuvable");
  const [licences, cards] = await Promise.all([
    IsicLicenseModel.find({ ...tf, studentId: params.id }).sort({ academicYear: -1 }).lean(),
    IsicCardModel.find({ ...tf, studentId: params.id }).populate("batchId", "reference academicYear universityName status")
      .sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  return ok({ student, licences, cards });
});

/**
 * PATCH — { fullName?, matricule?, schoolName?, email?, phone?, notes?,
 *           isicNumber?, numberReason?, addLicence?, cancelLicence? }
 * Changer ou retirer un numéro existant exige un motif, conservé dans l'historique.
 */
export const PATCH = withAuth("isic", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  await ensureRegistryIndexes();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Étudiant introuvable");
  const tf = tenantFilter(auth);
  const b = await req.json().catch(() => ({}));
  const student = await IsicStudentModel.findOne({ _id: params.id, ...tf });
  if (!student) return notFound("Étudiant introuvable");

  // Identité
  for (const f of ["fullName", "matricule", "schoolName", "email", "phone", "notes"] as const) {
    if (f in b) (student as unknown as Record<string, unknown>)[f] = String(b[f] ?? "").trim() || undefined;
  }
  if (!student.fullName) return badRequest("Le nom est requis.");
  if (!student.schoolName) return badRequest("L'établissement est requis.");
  student.dedupKey = studentKey(student.schoolName, student.matricule, student.fullName);

  // Numéro
  if ("isicNumber" in b) {
    const next = normalizeIsicNumber(b.isicNumber);
    const current = student.isicNumber || "";
    if (next !== current) {
      if (next && !isPlausibleIsicNumber(next)) return badRequest("Numéro ISIC invalide.");
      const reason = String(b.numberReason || "").trim();
      if (current && !reason) return badRequest("Indiquez le motif du changement de numéro (carte perdue, erreur de saisie…).");
      if (next) {
        const owner = await IsicStudentModel.findOne({ ...tf, isicNumber: next, _id: { $ne: student._id } }).select("fullName schoolName").lean<{ fullName: string; schoolName: string } | null>();
        if (owner) return conflict(`Le numéro ${next} appartient déjà à ${owner.fullName} (${owner.schoolName}).`);
      }
      student.numberHistory.push({ number: current || "—", at: new Date(), by: new Types.ObjectId(auth.userId), reason: reason || "Attribution manuelle" });
      student.isicNumber = next || undefined;
      student.numberSource = next ? "manuel" : undefined;
      student.numberAssignedAt = next ? new Date() : undefined;
    }
  }

  try {
    await student.save();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return conflict("Conflit : un autre étudiant a le même établissement et matricule, ou le même numéro ISIC.");
    }
    throw err;
  }

  // Licences
  if (b.addLicence) {
    if (!isAcademicYear(b.addLicence)) return badRequest("Année académique invalide (format 2025-2026).");
    await IsicLicenseModel.updateOne(
      { tenantId: auth.tenantId, studentId: student._id, academicYear: b.addLicence },
      { $set: { status: "active" }, $setOnInsert: { validUntil: defaultValidUntil(b.addLicence), source: "manuel", createdBy: auth.userId } },
      { upsert: true },
    );
  }
  if (b.cancelLicence && isAcademicYear(b.cancelLicence)) {
    await IsicLicenseModel.updateOne({ ...tf, studentId: student._id, academicYear: b.cancelLicence }, { $set: { status: "cancelled" } });
  }

  await logAudit(auth, "UPDATE", "isic", { resourceId: String(student._id), metadata: { registry: "student" } });
  return ok(student);
});

/** DELETE — archive la fiche (l'historique et le numéro restent réservés). */
export const DELETE = withAuth("isic", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound("Étudiant introuvable");
  const r = await IsicStudentModel.updateOne({ _id: params.id, ...tenantFilter(auth) }, { $set: { archived: true } });
  if (!r.matchedCount) return notFound("Étudiant introuvable");
  await logAudit(auth, "DELETE", "isic", { resourceId: String(params.id), metadata: { registry: "student-archived" } });
  return ok({ archived: true });
});
