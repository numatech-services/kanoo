/**
 * Déclaration CNSS : période, échéance et totaux à partir des bulletins.
 *
 * Guide de l'employeur CNSS (juillet 2025), IX : moins de 20 salariés,
 * déclaration et paiement trimestriels ; 20 salariés et plus, mensuels ;
 * exigibilité dans les 30 jours qui suivent la fin de la période.
 */

/** Effectif à partir duquel la déclaration devient mensuelle. */
export const SEUIL_CNSS_MENSUEL = 20;

export type PeriodiciteCnss = "mensuelle" | "trimestrielle";

export function periodiciteCnss(effectif: number): PeriodiciteCnss {
  return effectif >= SEUIL_CNSS_MENSUEL ? "mensuelle" : "trimestrielle";
}

export interface PeriodeCnss { annee: number; mois?: number; trimestre?: number }

/** Mois couverts par la période (1 à 12). */
export function moisDeLaPeriode(p: PeriodeCnss): { debut: number; fin: number } {
  if (p.mois) return { debut: p.mois, fin: p.mois };
  const t = p.trimestre ?? 1;
  return { debut: (t - 1) * 3 + 1, fin: t * 3 };
}

/** Date limite : 30 jours après le dernier jour de la période. */
export function echeanceCnss(p: PeriodeCnss): Date {
  const { fin } = moisDeLaPeriode(p);
  const finPeriode = new Date(p.annee, fin, 0);
  return new Date(finPeriode.getFullYear(), finPeriode.getMonth(), finPeriode.getDate() + 30);
}

export function libellePeriodeCnss(p: PeriodeCnss): string {
  return p.mois ? `${String(p.mois).padStart(2, "0")}/${p.annee}` : `T${p.trimestre}/${p.annee}`;
}

export interface PayslipCnss {
  grossSalary: number; grossTotal?: number; cnssBase?: number;
  cnssEmployee: number; cnssEmployer: number;
  cnssBranches?: { pf?: number; atmp?: number; pensions?: number; anpe?: number };
  employeeId?: unknown;
}

/** Assiette déclarée d'un bulletin : plafonnée s'il a été émis depuis la mise à jour, sinon le brut. */
export function assietteBulletin(p: PayslipCnss): number {
  return p.cnssBase ?? p.grossTotal ?? p.grossSalary;
}

export function totauxCnss(payslips: PayslipCnss[]) {
  const t = { assiette: 0, salarie: 0, patronal: 0, branches: { pf: 0, atmp: 0, pensions: 0, anpe: 0 }, salaries: 0 };
  const salaries = new Set<string>();
  for (const p of payslips) {
    if (p.cnssEmployee + p.cnssEmployer <= 0) continue;
    t.assiette += assietteBulletin(p);
    t.salarie += p.cnssEmployee;
    t.patronal += p.cnssEmployer;
    // Bulletins antérieurs, sans ventilation : la part patronale est portée
    // en pensions, comme le faisait l'ancien taux global.
    const b = p.cnssBranches;
    if (b) {
      t.branches.pf += b.pf ?? 0; t.branches.atmp += b.atmp ?? 0;
      t.branches.pensions += b.pensions ?? 0; t.branches.anpe += b.anpe ?? 0;
    } else t.branches.pensions += p.cnssEmployer;
    const id = p.employeeId && typeof p.employeeId === "object" && "_id" in p.employeeId ? (p.employeeId as { _id: unknown })._id : p.employeeId;
    if (id) salaries.add(String(id));
  }
  t.salaries = salaries.size;
  return { ...t, total: t.salarie + t.patronal };
}
