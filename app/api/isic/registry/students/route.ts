import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, conflict, tenantFilter, getPagination, paginatedResponse } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicLicenseModel } from "@/models/IsicLicense";
import { isAcademicYear, normalizeIsicNumber, shiftAcademicYear, studentKey } from "@/lib/isic-registry";
import { applyRegistryEntries } from "@/lib/isic-registry-server";

export const dynamic = "force-dynamic";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/isic/registry/students
 *   ?q=        nom, matricule ou numéro
 *   &school=   établissement (exact)
 *   &number=   with | without
 *   &year=2025-2026 &coverage= covered | notcovered | torenew
 */
export const GET = withAuth("isic", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const p = getPagination(req);
  const url = new URL(req.url);
  const tf = tenantFilter(auth);
  const filter: Record<string, unknown> = { ...tf, archived: { $ne: true } };

  const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ fullName: rx }, { matricule: rx }, { isicNumber: normalizeIsicNumber(q) || "—" }];
  }
  const school = url.searchParams.get("school");
  if (school) filter.schoolName = school;
  const number = url.searchParams.get("number");
  if (number === "with") filter.isicNumber = { $type: "string" };
  if (number === "without") filter.$and = [{ $or: [{ isicNumber: { $exists: false } }, { isicNumber: null }, { isicNumber: "" }] }];

  const year = url.searchParams.get("year");
  const coverage = url.searchParams.get("coverage");
  if (isAcademicYear(year) && coverage) {
    const lic = { ...tf, status: "active" };
    const inYear = await IsicLicenseModel.distinct("studentId", { ...lic, academicYear: year });
    if (coverage === "covered") filter._id = { $in: inYear };
    else if (coverage === "notcovered") filter._id = { $nin: inYear };
    else if (coverage === "torenew") {
      const prev = await IsicLicenseModel.distinct("studentId", { ...lic, academicYear: shiftAcademicYear(year, -1) });
      const covered = new Set(inYear.map(String));
      filter._id = { $in: prev.filter(id => !covered.has(String(id))) };
    }
  }

  const [items, total] = await Promise.all([
    IsicStudentModel.find(filter).sort({ schoolName: 1, fullName: 1 }).skip(p.skip).limit(p.limit)
      .select("fullName matricule schoolName isicNumber email phone numberSource createdAt")
      .lean<Array<{ _id: Types.ObjectId } & Record<string, unknown>>>(),
    IsicStudentModel.countDocuments(filter),
  ]);

  // Années couvertes de chaque étudiant de la page.
  const years = await IsicLicenseModel.aggregate([
    { $match: { ...tf, status: "active", studentId: { $in: items.map(i => i._id) } } },
    { $group: { _id: "$studentId", years: { $push: "$academicYear" } } },
  ]);
  const byStudent = new Map(years.map(y => [String(y._id), (y.years as string[]).sort().reverse()]));
  return paginatedResponse(items.map(i => ({ ...i, years: byStudent.get(String(i._id)) ?? [] })), total, p);
});

/** POST — ajout manuel d'un étudiant (avec numéro et année s'ils sont connus). */
export const POST = withAuth("isic", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const b = await req.json().catch(() => ({}));
  if (!String(b.fullName || "").trim()) return badRequest("Le nom est requis.");
  if (!String(b.schoolName || "").trim()) return badRequest("L'établissement est requis.");
  if (b.academicYear && !isAcademicYear(b.academicYear)) return badRequest("Année académique invalide (format 2025-2026).");
  // Vérifié AVANT toute écriture : un ajout manuel ne doit jamais modifier en
  // douce la fiche d'un étudiant existant.
  const key = studentKey(String(b.schoolName), b.matricule ? String(b.matricule) : undefined, String(b.fullName));
  if (await IsicStudentModel.exists({ ...tenantFilter(auth), dedupKey: key })) {
    return conflict("Cet étudiant existe déjà dans le registre (même établissement et même matricule).");
  }

  const { report, byLine } = await applyRegistryEntries(auth, [{
    line: 1, fullName: String(b.fullName), matricule: b.matricule ? String(b.matricule) : undefined,
    schoolName: String(b.schoolName), schoolId: b.schoolId, email: b.email, phone: b.phone,
    number: b.isicNumber ? String(b.isicNumber) : undefined, academicYear: b.academicYear || undefined,
  }], { numberSource: "manuel", licenceSource: "manuel" });

  if (report.skipped.length) return badRequest(report.skipped[0].reason);
  if (report.created === 0) return conflict("Cet étudiant existe déjà dans le registre (même établissement et même matricule).");
  if (report.conflicts.length) {
    // La fiche est créée ; seul le numéro est refusé — on le dit clairement.
    return created({ studentId: byLine.get(1)?.studentId, warning: report.conflicts[0].reason });
  }
  await logAudit(auth, "CREATE", "isic", { resourceId: byLine.get(1)?.studentId, metadata: { registry: "student" } });
  return created({ studentId: byLine.get(1)?.studentId });
});
