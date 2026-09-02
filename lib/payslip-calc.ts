/**
 * Moteur de calcul de bulletins de paie — Kanoo Niger
 * Conforme : Code du Travail Niger, CGI, CNSS
 */

import {
  CNSS_SALARIE, CNSS_PATRONAL,
  calculerIR, verifierSMIG, calculerPrimeAnciennete,
  SMIG_MENSUEL,
} from "./niger-fiscal";

export interface ManualDeduction {
  label: string;
  amount: number;
  type: "deduction" | "addition"; // retenue ou prime
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

  // Déductions/primes manuelles
  manualItems?: ManualDeduction[];
}

export interface PayslipResult {
  // Salaire de base
  grossSalary: number;
  smigCheck: { conforme: boolean; ecart: number; message: string };

  // Prime d'ancienneté
  seniority: { annees: number; mois: number; taux: number; montant: number };

  // Salaire brut total (base + ancienneté + primes manuelles)
  grossTotal: number;

  // Cotisations
  cnssEmployee: number;
  cnssEmployer: number;
  ir: number;

  // Déductions/primes manuelles
  manualItems: ManualDeduction[];
  totalManualDeductions: number;
  totalManualAdditions: number;

  // Net
  netImposable: number;  // Brut − CNSS salarié
  netAPayer: number;     // Net imposable − IR − déductions manuelles

  // Charge patronale totale
  totalEmployerCost: number; // Brut total + CNSS patronal

  // Alertes
  alerts: string[];
}

/**
 * Calcule un bulletin de paie complet
 */
export function calculerBulletinDePaie(input: PayslipInput): PayslipResult {
  const alerts: string[] = [];

  // ─── Stagiaires / Freelances — calcul simplifié ───────────────────────────
  if (input.employeeType !== "employee") {
    const indemnity = input.indemnity || 0;
    const manualItems = input.manualItems || [];
    const totalDeductions = manualItems.filter(i => i.type === "deduction").reduce((s, i) => s + i.amount, 0);
    const totalAdditions = manualItems.filter(i => i.type === "addition").reduce((s, i) => s + i.amount, 0);
    return {
      grossSalary: indemnity,
      smigCheck: { conforme: true, ecart: 0, message: "Non applicable (stagiaire/freelance)" },
      seniority: { annees: 0, mois: 0, taux: 0, montant: 0 },
      grossTotal: indemnity + totalAdditions,
      cnssEmployee: 0,
      cnssEmployer: 0,
      ir: 0,
      manualItems,
      totalManualDeductions: totalDeductions,
      totalManualAdditions: totalAdditions,
      netImposable: indemnity + totalAdditions,
      netAPayer: indemnity + totalAdditions - totalDeductions,
      totalEmployerCost: indemnity + totalAdditions,
      alerts,
    };
  }

  // ─── Employés salariés ────────────────────────────────────────────────────

  // 1. Vérification SMIG
  const smigCheck = verifierSMIG(input.grossSalary);
  if (!smigCheck.conforme) alerts.push(smigCheck.message);

  // 2. Prime d'ancienneté
  const seniority = input.includeSeniority
    ? calculerPrimeAnciennete(input.grossSalary, input.startDate)
    : { annees: 0, mois: 0, taux: 0, montant: 0 };

  // 3. Items manuels (primes, avances, etc.)
  const manualItems = input.manualItems || [];
  const totalManualAdditions = manualItems.filter(i => i.type === "addition").reduce((s, i) => s + i.amount, 0);
  const totalManualDeductions = manualItems.filter(i => i.type === "deduction").reduce((s, i) => s + i.amount, 0);

  // 4. Salaire brut total
  const grossTotal = input.grossSalary + seniority.montant + totalManualAdditions;

  // 5. CNSS
  const cnssEmployee = input.includeCnss ? Math.round(grossTotal * CNSS_SALARIE) : 0;
  const cnssEmployer = input.includeCnss ? Math.round(grossTotal * CNSS_PATRONAL) : 0;

  // 6. Net imposable (base IR)
  const netImposable = grossTotal - cnssEmployee;

  // 7. IR progressif
  const ir = input.includeIr ? calculerIR(netImposable) : 0;

  // 8. Net à payer
  const netAPayer = netImposable - ir - totalManualDeductions;
  if (netAPayer < 0) alerts.push(`⚠ Net à payer négatif (${netAPayer.toLocaleString("fr-FR")} XOF) — vérifier les retenues`);

  // 9. Coût total employeur
  const totalEmployerCost = grossTotal + cnssEmployer;

  return {
    grossSalary: input.grossSalary,
    smigCheck,
    seniority,
    grossTotal,
    cnssEmployee,
    cnssEmployer,
    ir,
    manualItems,
    totalManualDeductions,
    totalManualAdditions,
    netImposable,
    netAPayer,
    totalEmployerCost,
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
