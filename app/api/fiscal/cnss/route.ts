import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, conflict, tenantFilter } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";
import { EmployeeModel } from "@/models/Employee";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { TokenPayload } from "@/lib/auth";
import { echeanceCnss, moisDeLaPeriode, periodiciteCnss, totauxCnss, type PeriodeCnss, type PayslipCnss } from "@/lib/cnss-declaration";

/**
 * Période demandée : `mois` (déclaration mensuelle, 20 salariés et plus) ou
 * `trimestre` (moins de 20 salariés). Sans précision : le trimestre en cours.
 */
function readPeriod(src: { annee?: unknown; mois?: unknown; trimestre?: unknown }): PeriodeCnss | string {
  const annee = Number(src.annee ?? new Date().getFullYear());
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) return "Année invalide.";
  if (src.mois !== undefined && src.mois !== null && src.mois !== "") {
    const mois = Number(src.mois);
    if (!Number.isInteger(mois) || mois < 1 || mois > 12) return "Mois doit être entre 1 et 12.";
    return { annee, mois };
  }
  const trimestre = Number(src.trimestre ?? Math.ceil((new Date().getMonth() + 1) / 3));
  if (![1, 2, 3, 4].includes(trimestre)) return "Trimestre doit être entre 1 et 4.";
  return { annee, trimestre };
}

const periodFilter = (p: PeriodeCnss) => p.mois
  ? { "period.annee": p.annee, "period.mois": p.mois }
  : { "period.annee": p.annee, "period.trimestre": p.trimestre, "period.mois": { $exists: false } };

export const GET = withAuth("fiscalDeclarations", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const q = new URL(req.url).searchParams;
  const period = readPeriod({ annee: q.get("annee") ?? undefined, mois: q.get("mois") ?? undefined, trimestre: q.get("trimestre") ?? undefined });
  if (typeof period === "string") return badRequest(period);
  const { debut, fin } = moisDeLaPeriode(period);

  const [payslips, effectif, declaration] = await Promise.all([
    PayslipModel.find({ ...tenantFilter(auth), year: period.annee, month: { $gte: debut, $lte: fin } })
      .populate("employeeId", "firstName lastName cnssNumber code").lean<Array<PayslipCnss & Record<string, unknown>>>(),
    // Effectif qui fixe la périodicité : salariés et stagiaires actifs.
    EmployeeModel.countDocuments({ ...tenantFilter(auth), isActive: true, employeeType: { $ne: "freelance" } }),
    FiscalDeclarationModel.findOne({ ...tenantFilter(auth), type: "cnss", ...periodFilter(period) }).lean<{ status?: string } | null>(),
  ]);
  const t = totauxCnss(payslips);

  return ok({
    periode: period,
    periodicite: periodiciteCnss(effectif),
    effectif,
    echeance: echeanceCnss(period),
    payslipsCount: payslips.length,
    salariesDeclares: t.salaries,
    // Assiette déclarée : plafonnée à 500 000 FCFA par salarié et par mois.
    totalBrut: Math.round(t.assiette),
    cnssEmploye: Math.round(t.salarie),
    cnssPatronal: Math.round(t.patronal),
    branches: t.branches,
    totalCnss: Math.round(t.total),
    detail: payslips,
    declaration: declaration || null,
    statut: declaration?.status || "non_soumise",
  });
});

export const POST = withAuth("fiscalDeclarations", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const period = readPeriod(body);
  if (typeof period === "string") return badRequest(period);
  if (!(Number(body.totalCnss) >= 0) || !(Number(body.totalBrut) >= 0)) return badRequest("Montants invalides.");
  const dup = await FiscalDeclarationModel.exists({ ...tenantFilter(auth), type: "cnss", ...periodFilter(period) });
  const label = period.mois ? `du mois ${period.mois}/${period.annee}` : `du T${period.trimestre} ${period.annee}`;
  if (dup) return conflict(`Déclaration CNSS ${label} déjà enregistrée.`);
  const decl = await FiscalDeclarationModel.create({
    tenantId: auth.tenantId, type: "cnss",
    period: period.mois ? { mois: period.mois, annee: period.annee } : { trimestre: period.trimestre, annee: period.annee },
    amounts: { base: body.totalBrut, montant: body.totalCnss, net: body.totalCnss },
    status: "submitted", submittedAt: new Date(), createdBy: auth.userId,
  });
  return ok(decl);
});
