import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { IsicStudentModel } from "@/models/IsicStudent";
import { IsicLicenseModel } from "@/models/IsicLicense";
import { academicYearOf, isAcademicYear, coverageFor, shiftAcademicYear } from "@/lib/isic-registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/isic/registry/stats?year=2025-2026
 * Combien d'étudiants ont une licence (couverts), dont nouveaux / renouvelés,
 * combien restent à renouveler, combien attendent leur numéro — au total et
 * par établissement.
 */
export const GET = withAuth("isic", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const tf = tenantFilter(auth);
  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const year = isAcademicYear(yearParam) ? yearParam : academicYearOf();

  const [students, licences, yearsRaw] = await Promise.all([
    IsicStudentModel.find({ ...tf, archived: { $ne: true } }).select("_id schoolName isicNumber hasPhoto")
      .lean<Array<{ _id: Types.ObjectId; schoolName: string; isicNumber?: string; hasPhoto?: boolean }>>(),
    IsicLicenseModel.aggregate([
      { $match: { ...tf, status: "active" } },
      { $group: { _id: "$studentId", years: { $push: "$academicYear" } } },
    ]),
    IsicLicenseModel.distinct("academicYear", { ...tf, status: "active" }),
  ]);

  const yearsOf = new Map<string, string[]>(licences.map(l => [String(l._id), l.years as string[]]));
  const withYears = students.map(s => ({ studentId: String(s._id), years: yearsOf.get(String(s._id)) ?? [], s }));

  const overall = coverageFor(year, withYears);
  const withNumber = students.filter(s => !!s.isicNumber).length;
  // Étudiants couverts cette année mais encore sans numéro : la liste à envoyer à ISIC.
  const coveredWithoutNumber = withYears.filter(x => x.years.includes(year) && !x.s.isicNumber).length;
  // Sans photo, ISIC ne peut pas produire la carte (11 doctorants sur 38 en 2025-2026).
  const coveredWithoutPhoto = withYears.filter(x => x.years.includes(year) && !x.s.hasPhoto).length;

  const schools = new Map<string, typeof withYears>();
  for (const x of withYears) schools.set(x.s.schoolName, [...(schools.get(x.s.schoolName) ?? []), x]);
  const bySchool = [...schools.entries()].map(([school, list]) => ({
    school,
    students: list.length,
    withNumber: list.filter(x => !!x.s.isicNumber).length,
    withoutPhoto: list.filter(x => x.years.includes(year) && !x.s.hasPhoto).length,
    ...coverageFor(year, list),
  })).sort((a, b) => b.covered - a.covered || a.school.localeCompare(b.school));

  const years = [...new Set([...(yearsRaw as string[]), year, shiftAcademicYear(year, 1)])].sort().reverse();

  return ok({
    year,
    totals: {
      students: students.length,
      withNumber,
      withoutNumber: students.length - withNumber,
      coveredWithoutNumber,
      coveredWithoutPhoto,
      ...overall,
      returning: overall.covered - overall.fresh - overall.renewed,
    },
    bySchool,
    years,
  });
});
