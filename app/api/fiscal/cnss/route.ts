import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("fiscalDeclarations", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const annee = parseInt(url.searchParams.get("annee") || String(new Date().getFullYear()));
  const trimestre = parseInt(url.searchParams.get("trimestre") || String(Math.ceil((new Date().getMonth() + 1) / 3)));
  if (trimestre < 1 || trimestre > 4) return badRequest("Trimestre doit être entre 1 et 4");

  const startMonth = (trimestre - 1) * 3 + 1;
  const endMonth = trimestre * 3;

  const payslips = await PayslipModel.find({
    ...tenantFilter(auth),
    year: annee,
    month: { $gte: startMonth, $lte: endMonth },
  }).populate("employeeId", "firstName lastName cnssNumber code").lean();

  const totalGross = payslips.reduce((s, p) => s + p.grossSalary, 0);
  const totalEmployee = payslips.reduce((s, p) => s + p.cnssEmployee, 0);
  const totalEmployer = payslips.reduce((s, p) => s + p.cnssEmployer, 0);
  const totalCnss = totalEmployee + totalEmployer;

  const declaration = await FiscalDeclarationModel.findOne({
    ...tenantFilter(auth), type: "cnss", "period.annee": annee, "period.trimestre": trimestre,
  }).lean();

  return ok({
    periode: { trimestre, annee },
    payslipsCount: payslips.length,
    totalBrut: Math.round(totalGross),
    cnssEmploye: Math.round(totalEmployee),
    cnssPatronal: Math.round(totalEmployer),
    totalCnss: Math.round(totalCnss),
    detail: payslips,
    declaration: declaration || null,
    statut: declaration?.status || "non_soumise",
  });
});

export const POST = withAuth("fiscalDeclarations", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const decl = await FiscalDeclarationModel.create({
    tenantId: auth.tenantId, type: "cnss",
    period: { trimestre: body.trimestre, annee: body.annee },
    amounts: { base: body.totalBrut, montant: body.totalCnss, net: body.totalCnss },
    status: "submitted", submittedAt: new Date(), createdBy: auth.userId,
  });
  return ok(decl);
});
