/**
 * Moteur de calcul de bulletins de paie — Kanoo Niger
 *
 * CNSS (guides juillet 2025) et ITS (CGI 2026, art. 143 à 150), avec les
 * paramètres datés de la période payée (lib/paie-parametres.ts).
 */

import { calculerPrimeAnciennete, verifierSMIG } from "./niger-fiscal";
import {
  calculerCotisationsCnss, calculerITS, evaluerAvantagesEnNature, parametresPaie,
  type BranchesEmployeur, type CategorieCnss, type ResultatITS,
} from "./paie-parametres";

export interface ManualDeduction {
  label: string;
  amount: number;
  type: "deduction" | "addition"; // retenue ou prime
  /**
   * Prime soumise à la CNSS et à l'ITS (par défaut). `false` pour un
   * remboursement de frais, une indemnité de mission ou de licenciement :
   * versée, mais hors assiette (CGI art. 140, guide CNSS V).
   */
  subject?: boolean;
}

export interface PayslipInput {
  // Employé
  grossSalary: number;           // Salaire brut de base
  startDate: Date;               // Date d'entrée (pour ancienneté)
  employeeType: "employee" | "intern" | "freelance";
  indemnity?: number;            // Montant pour intern/freelance

  // Options calcul
  includeCnss: boolean;
  includeIr: boolean;
  includeSeniority: boolean;     // Prime d'ancienneté

  // Situation fiscale et sociale du salarié
  /** Charges de famille au sens de l'ITS (conjoint sans revenu + enfants), de 0 à 7. */
  familyCharges?: number;
  /** Catégorie CNSS d'un salarié (`standard` ou `detache`) ; les stagiaires cotisent au taux des apprentis. */
  cnssCategory?: "standard" | "detache";
  /** Indemnité de dépaysement mensuelle (expatrié) : versée, imposable, ouvre l'abattement de 17 % si ≥ 40 % du salaire de base. */
  expatAllowance?: number;
  /** Primes d'assurance payées par le salarié, déductibles de l'ITS dans la limite de 20 000 FCFA. */
  insurancePremium?: number;
  /** Avantages en nature, évalués aux forfaits de l'art. 144. */
  benefitsInKind?: Array<{ kind: string; count?: number }>;

  // Déductions/primes manuelles
  manualItems?: ManualDeduction[];

  /**
   * Fin de la période de paie. Sert à apprécier l'ancienneté et à choisir les
   * paramètres en vigueur : sans elle, le calcul se faisait à la date du jour,
   * et rééditer un bulletin ancien en changeait le montant.
   */
  periodEnd?: Date;
}

export interface PayslipResult {
  // Salaire de base
  grossSalary: number;
  smigCheck: { conforme: boolean; ecart: number; message: string };

  // Prime d'ancienneté
  seniority: { annees: number; mois: number; taux: number; montant: number };

  /** Brut en espèces : base + ancienneté + dépaysement + primes (soumises ou non). */
  grossTotal: number;
  /** Avantages en nature : soumis à la CNSS et à l'ITS, non versés. */
  benefitsInKind: number;
  benefitsDetail: Array<{ kind: string; label: string; amount: number }>;
  expatAllowance: number;

  // Cotisations
  cnssCategory: CategorieCnss;
  /** Assiette CNSS après plancher (SMIG) et plafond (500 000 / mois). */
  cnssBase: number;
  cnssEmployee: number;
  cnssEmployer: number;
  cnssBranches: BranchesEmployeur;
  cnssRates: { employee: number; employer: number };

  /** Impôt sur les traitements et salaires retenu. */
  ir: number;
  its: ResultatITS | null;

  // Déductions/primes manuelles
  manualItems: ManualDeduction[];
  totalManualDeductions: number;
  totalManualAdditions: number;

  /** Base imposable de l'ITS (arrondie au millier) ; avant 2026, brut − CNSS salariale. */
  netImposable: number;
  /** Brut en espèces − CNSS salariale − ITS − retenues. */
  netAPayer: number;

  // Charge patronale totale
  totalEmployerCost: number; // Brut en espèces + CNSS patronal

  /** Date d'effet des paramètres appliqués (AAAA-MM-JJ). */
  paramsVersion: string;

  // Alertes
  alerts: string[];
}

const ZERO_BRANCHES: BranchesEmployeur = { pf: 0, atmp: 0, pensions: 0, anpe: 0 };

/**
 * Calcule un bulletin de paie complet
 */
export function calculerBulletinDePaie(input: PayslipInput): PayslipResult {
  const alerts: string[] = [];
  const date = input.periodEnd ?? new Date();
  const params = parametresPaie(date);
  const manualItems = (input.manualItems || []).map(i => ({ ...i, subject: i.type === "addition" ? i.subject !== false : undefined }));
  const additions = manualItems.filter(i => i.type === "addition");
  const totalManualAdditions = additions.reduce((s, i) => s + i.amount, 0);
  const subjectAdditions = additions.filter(i => i.subject !== false).reduce((s, i) => s + i.amount, 0);
  const totalManualDeductions = manualItems.filter(i => i.type === "deduction").reduce((s, i) => s + i.amount, 0);

  // ─── Freelances : honoraires, hors paie salariale ─────────────────────────
  // Ni CNSS ni ITS : la retenue sur prestation de services relève des
  // précomptes (paiement fournisseur), pas du bulletin.
  if (input.employeeType === "freelance") {
    const indemnity = input.indemnity || 0;
    const gross = indemnity + totalManualAdditions;
    return {
      grossSalary: indemnity,
      smigCheck: { conforme: true, ecart: 0, message: "Non applicable (freelance)" },
      seniority: { annees: 0, mois: 0, taux: 0, montant: 0 },
      grossTotal: gross, benefitsInKind: 0, benefitsDetail: [], expatAllowance: 0,
      cnssCategory: "standard", cnssBase: 0, cnssEmployee: 0, cnssEmployer: 0, cnssBranches: { ...ZERO_BRANCHES },
      cnssRates: { employee: 0, employer: 0 },
      ir: 0, its: null,
      manualItems, totalManualDeductions, totalManualAdditions,
      netImposable: gross,
      netAPayer: gross - totalManualDeductions,
      totalEmployerCost: gross,
      paramsVersion: params.depuis,
      alerts,
    };
  }

  const intern = input.employeeType === "intern";
  const base = intern ? input.indemnity || 0 : input.grossSalary;

  // 1. SMIG (salariés)
  const smigCheck = intern
    ? { conforme: true, ecart: 0, message: "Non applicable (stagiaire)" }
    : verifierSMIG(base, date);
  if (!smigCheck.conforme) alerts.push(smigCheck.message);

  // 2. Prime d'ancienneté (salariés)
  const seniority = !intern && input.includeSeniority
    ? calculerPrimeAnciennete(base, input.startDate, input.periodEnd)
    : { annees: 0, mois: 0, taux: 0, montant: 0 };

  // 3. Dépaysement et avantages en nature
  const expatAllowance = intern ? 0 : Math.max(0, Math.round(input.expatAllowance ?? 0));
  const benefits = intern ? { total: 0, detail: [] } : evaluerAvantagesEnNature(input.benefitsInKind ?? [], base);

  // 4. Brut en espèces et rémunération soumise
  const grossTotal = base + seniority.montant + expatAllowance + totalManualAdditions;
  const subjectPay = base + seniority.montant + expatAllowance + subjectAdditions + benefits.total;

  // 5. CNSS : plancher au SMIG pour un salarié, plafond mensuel
  const cnssCategory: CategorieCnss = intern ? "stagiaire" : input.cnssCategory ?? "standard";
  const cnss = input.includeCnss
    ? calculerCotisationsCnss(subjectPay, cnssCategory, date, { plancher: !intern })
    : null;
  if (cnss?.relevee) alerts.push(`Assiette CNSS relevée au SMIG (${params.smig.toLocaleString("fr-FR")} FCFA)`);
  const cnssEmployee = cnss?.salarie ?? 0;
  const cnssEmployer = cnss?.patronal ?? 0;
  const rates = params.cnss[cnssCategory];

  // 6. ITS — avant 2026, Kanoo n'imposait pas les indemnités de stage : les
  // bulletins de ces périodes restent tels qu'ils ont été émis.
  const its = input.includeIr && !(intern && !params.its)
    ? calculerITS({
        revenuBrut: subjectPay,
        remunerationPrincipale: base,
        retraite: cnssEmployee,
        assurance: input.insurancePremium,
        indemniteDepaysement: expatAllowance,
        chargesFamille: input.familyCharges,
      }, date)
    : null;
  const ir = its?.impot ?? 0;
  const netImposable = its ? its.base : Math.max(0, subjectPay - cnssEmployee);

  // 7. Net à payer : les avantages en nature, non versés, n'y entrent pas
  const netAPayer = grossTotal - cnssEmployee - ir - totalManualDeductions;
  if (netAPayer < 0) alerts.push(`⚠ Net à payer négatif (${netAPayer.toLocaleString("fr-FR")} FCFA) — vérifier les retenues`);

  return {
    grossSalary: base,
    smigCheck,
    seniority,
    grossTotal,
    benefitsInKind: benefits.total,
    benefitsDetail: benefits.detail,
    expatAllowance,
    cnssCategory,
    cnssBase: cnss?.assiette ?? 0,
    cnssEmployee,
    cnssEmployer,
    cnssBranches: cnss?.branches ?? { ...ZERO_BRANCHES },
    cnssRates: cnss
      ? { employee: rates.salarie, employer: rates.employeur.pf + rates.employeur.atmp + rates.employeur.pensions + rates.employeur.anpe }
      : { employee: 0, employer: 0 },
    ir,
    its,
    manualItems,
    totalManualDeductions,
    totalManualAdditions,
    netImposable,
    netAPayer,
    totalEmployerCost: grossTotal + cnssEmployer,
    paramsVersion: params.depuis,
    alerts,
  };
}

/**
 * Génère un récapitulatif mensuel pour une liste de bulletins
 */
export function recapitulatifMensuel(results: PayslipResult[]): {
  totalBrut: number;
  totalCnssEmploye: number;
  totalCnssPatronal: number;
  totalIR: number;
  totalNet: number;
  totalCoutEmployeur: number;
  nombreBulletins: number;
} {
  return {
    totalBrut: results.reduce((s, r) => s + r.grossTotal, 0),
    totalCnssEmploye: results.reduce((s, r) => s + r.cnssEmployee, 0),
    totalCnssPatronal: results.reduce((s, r) => s + r.cnssEmployer, 0),
    totalIR: results.reduce((s, r) => s + r.ir, 0),
    totalNet: results.reduce((s, r) => s + r.netAPayer, 0),
    totalCoutEmployeur: results.reduce((s, r) => s + r.totalEmployerCost, 0),
    nombreBulletins: results.length,
  };
}
