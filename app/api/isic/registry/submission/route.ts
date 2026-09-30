import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import JSZip from "jszip";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicLicenseModel } from "@/models/IsicLicense";
import { IsicPhotoModel } from "@/models/IsicPhoto";
import { IsicSettingsModel } from "@/models/IsicSettings";
import { isAcademicYear, checkForIsic, photoFileName, cleanName, type IsicIssue } from "@/lib/isic-registry";
import { buildSubmissionXlsx, type SubmissionRow } from "@/lib/isic-xlsx";

export const dynamic = "force-dynamic";

interface Student {
  _id: Types.ObjectId; fullName: string; firstName?: string; lastName?: string; matricule?: string; schoolName: string;
  email?: string; phone?: string; dateOfBirth?: Date; city?: string; className?: string; hasPhoto?: boolean; isicNumber?: string;
}

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "ISIC";

/**
 * GET /api/isic/registry/submission?year=&school=&scope=new|renewal|all&format=check|xlsx|zip
 *
 * Prépare l'envoi à ISIC pour les étudiants couverts l'année donnée :
 *  - check : contrôles avant envoi (photo, date de naissance, e-mail…) ;
 *  - xlsx  : le fichier au format exact d'ISIC (24 colonnes) ;
 *  - zip   : le paquet complet — fichier + photos nommées « <Personal ID>.jpg ».
 * Nouvelles cartes : « NEW_CARD ». Renouvellements : le code réglé par
 * l'organisation, et le numéro existant dans « Card number ».
 */
export const GET = withAuth("isic", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const tf = tenantFilter(auth);
  const url = new URL(req.url);
  const year = url.searchParams.get("year");
  const school = url.searchParams.get("school") || "";
  const scope = (url.searchParams.get("scope") || "new") as "new" | "renewal" | "all";
  const format = (url.searchParams.get("format") || "check") as "check" | "xlsx" | "zip";
  if (!isAcademicYear(year)) return badRequest("Année académique requise (format 2025-2026).");
  if (!["new", "renewal", "all"].includes(scope) || !["check", "xlsx", "zip"].includes(format)) return badRequest("Paramètres invalides.");
  // Contrôle permis ; téléchargement du fichier ISIC interdit à un stagiaire.
  if (format !== "check" && isInternFor(auth, "isic")) return forbidden(INTERN_EXPORT_MESSAGE);

  const covered = await IsicLicenseModel.distinct("studentId", { ...tf, status: "active", academicYear: year });
  const filter: Record<string, unknown> = { ...tf, archived: { $ne: true }, _id: { $in: covered } };
  if (school) filter.schoolName = school;
  if (scope === "new") filter.$or = [{ isicNumber: { $exists: false } }, { isicNumber: null }, { isicNumber: "" }];
  if (scope === "renewal") filter.isicNumber = { $type: "string", $ne: "" };

  const students = await IsicStudentModel.find(filter).sort({ schoolName: 1, lastName: 1, fullName: 1 }).limit(20000)
    .select("fullName firstName lastName matricule schoolName email phone dateOfBirth city className hasPhoto isicNumber")
    .lean<Student[]>();

  const settings = await IsicSettingsModel.findOne({ tenantId: auth.tenantId }).lean<{ renewalRequestType?: string } | null>();
  const renewalCode = settings?.renewalRequestType || "";
  const renewals = students.filter(s => !!s.isicNumber).length;
  const renewalCodeMissing = renewals > 0 && !renewalCode;

  if (format === "check") {
    const withIssues: Array<{ _id: string; fullName: string; matricule?: string; schoolName: string; issues: IsicIssue[] }> = [];
    let errors = 0, warnings = 0;
    for (const s of students) {
      const issues = checkForIsic(s);
      if (!issues.length) continue;
      errors += issues.filter(i => i.level === "error").length;
      warnings += issues.filter(i => i.level === "warning").length;
      withIssues.push({ _id: String(s._id), fullName: s.fullName, matricule: s.matricule, schoolName: s.schoolName, issues });
    }
    return ok({
      count: students.length, newCards: students.length - renewals, renewals,
      withPhoto: students.filter(s => s.hasPhoto).length,
      ready: students.length - withIssues.filter(x => x.issues.some(i => i.level === "error")).length,
      errors, warnings, renewalCodeMissing, renewalCode, students: withIssues,
    });
  }

  if (!students.length) return badRequest("Aucun étudiant à envoyer pour ces critères.");
  if (renewalCodeMissing) {
    return badRequest("Renseignez d'abord le code ISIC des renouvellements (Request Type) dans « Envoi ISIC », ou limitez l'envoi aux nouvelles cartes.");
  }

  const rows: SubmissionRow[] = students.map(s => ({
    requestType: s.isicNumber ? renewalCode : "NEW_CARD",
    personalId: cleanName(s.matricule),
    // Prénom / nom séparés : repris tels qu'ils figuraient dans vos colonnes.
    firstName: cleanName(s.firstName),
    lastName: cleanName(s.lastName) || (s.firstName ? "" : cleanName(s.fullName)),
    city: s.city, email: s.email, phone: s.phone,
    dateOfBirth: s.dateOfBirth ? new Date(s.dateOfBirth) : null,
    className: s.className, institution: s.schoolName,
    cardNumber: s.isicNumber || undefined,
  }));
  const xlsx = await buildSubmissionXlsx(rows);
  const base = `FICHIER ETUDIANTS ISIC ${school || "TOUS ETABLISSEMENTS"} - ${year}${scope === "renewal" ? " - RENOUVELLEMENTS" : ""}`;

  await logAudit(auth, "UPDATE", "isic", { metadata: { isicSubmission: { year, school, scope, format, count: students.length } } });

  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${slug(base)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Paquet : même structure que vos envois (un dossier avec l'Excel et les photos).
  const folder = `${year}-${slug(school || "ISIC")}`;
  const zip = new JSZip();
  const dir = zip.folder(folder)!;
  dir.file(`${base}.xlsx`, xlsx);
  const photos = await IsicPhotoModel.find({ tenantId: auth.tenantId, studentId: { $in: students.filter(s => s.hasPhoto).map(s => s._id) } })
    .select("studentId dataUri").lean<Array<{ studentId: Types.ObjectId; dataUri: string }>>();
  const byStudent = new Map(photos.map(p => [String(p.studentId), p.dataUri]));
  for (const s of students) {
    const uri = byStudent.get(String(s._id));
    if (!uri || !s.matricule) continue;
    dir.file(photoFileName(s.matricule), uri.slice(uri.indexOf(",") + 1), { base64: true });
  }
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${folder}.zip"`,
      "Cache-Control": "no-store",
    },
  });
});
