import { csvCell } from "@/lib/csv";
import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, tenantFilter, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicLicenseModel } from "@/models/IsicLicense";
import { isAcademicYear } from "@/lib/isic-registry";

export const dynamic = "force-dynamic";

const cell = csvCell;

/**
 * GET /api/isic/registry/export?filter=pending|all&school=&year=
 *  - pending : étudiants SANS numéro (liste à envoyer à ISIC pour numérotation),
 *    restreinte aux étudiants couverts l'année donnée si `year` est fourni ;
 *  - all     : le registre complet (sauvegarde, contrôle).
 * CSV `;` + BOM, s'ouvre tel quel dans Excel.
 */
export const GET = withAuth("isic", "read", async (req: NextRequest, auth: TokenPayload) => {
  // Pas d'export ni d'envoi vers l'extérieur pour un stagiaire.
  if (isInternFor(auth, "isic")) return forbidden(INTERN_EXPORT_MESSAGE);
  await connectDB();
  const tf = tenantFilter(auth);
  const url = new URL(req.url);
  const pending = url.searchParams.get("filter") === "pending";
  const school = url.searchParams.get("school");
  const year = url.searchParams.get("year");

  const filter: Record<string, unknown> = { ...tf, archived: { $ne: true } };
  if (school) filter.schoolName = school;
  if (pending) filter.$or = [{ isicNumber: { $exists: false } }, { isicNumber: null }, { isicNumber: "" }];
  if (isAcademicYear(year)) {
    filter._id = { $in: await IsicLicenseModel.distinct("studentId", { ...tf, status: "active", academicYear: year }) };
  }

  const students = await IsicStudentModel.find(filter).sort({ schoolName: 1, fullName: 1 }).limit(50000)
    .select("fullName matricule schoolName isicNumber email phone")
    .lean<Array<{ _id: Types.ObjectId; fullName: string; matricule?: string; schoolName: string; isicNumber?: string; email?: string; phone?: string }>>();
  const years = await IsicLicenseModel.aggregate([
    { $match: { ...tf, status: "active", studentId: { $in: students.map(s => s._id) } } },
    { $group: { _id: "$studentId", years: { $push: "$academicYear" } } },
  ]);
  const byStudent = new Map(years.map(y => [String(y._id), (y.years as string[]).sort().join(", ")]));

  const header = ["Nom", "Matricule", "Établissement", "Numéro ISIC", "Email", "Téléphone", "Années couvertes"];
  const lines = [header.map(cell).join(";"), ...students.map(s => [
    s.fullName, s.matricule, s.schoolName, s.isicNumber, s.email, s.phone, byStudent.get(String(s._id)),
  ].map(cell).join(";"))];

  const name = `${pending ? "isic-a-numeroter" : "registre-isic"}${isAcademicYear(year) ? `-${year}` : ""}.csv`;
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
