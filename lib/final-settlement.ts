/**
 * Solde de tout compte (calcul pur, testé sans base).
 *
 *  - salaire du mois de sortie au prorata des jours calendaires de présence
 *    (base 30 ; mois complet si la sortie tombe le dernier jour) ;
 *  - indemnité compensatrice de congés payés : jours ouvrables acquis non
 *    pris × salaire de base / 26 (jours ouvrables d'un mois).
 *
 * Les indemnités de rupture (préavis, licenciement, fin de CDD prévue par la
 * convention collective) dépendent du motif et de la convention : elles sont
 * ajoutées à la main sur le bulletin de sortie.
 */

export interface SettlementInput {
  exitDate: Date;
  startDate: Date;
  /** Salaire de base mensuel (salarié) ou indemnité mensuelle (stagiaire). */
  monthlyBase: number;
  employeeType: "employee" | "intern" | "freelance";
  /** Jours de congé acquis non pris à la date de sortie. */
  leaveAvailable: number;
}

export interface Settlement {
  month: number; year: number;
  daysPresent: number; fullMonth: boolean;
  proratedBase: number;
  leaveDays: number; leaveIndemnity: number;
  totalGross: number;
}

export function finalSettlement(i: SettlementInput): Settlement {
  const exit = new Date(i.exitDate);
  const year = exit.getFullYear(), month = exit.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const start = new Date(i.startDate);
  const firstDay = start.getFullYear() === year && start.getMonth() + 1 === month ? start.getDate() : 1;
  const fullMonth = firstDay === 1 && exit.getDate() === lastDay;
  const daysPresent = Math.max(0, exit.getDate() - firstDay + 1);
  const base = Math.max(0, Math.round(i.monthlyBase || 0));
  const proratedBase = fullMonth ? base : Math.round((base * Math.min(30, daysPresent)) / 30);
  // Les congés payés ne concernent que les salariés.
  const leaveDays = i.employeeType === "employee" ? Math.max(0, Math.round((i.leaveAvailable || 0) * 10) / 10) : 0;
  const leaveIndemnity = Math.round((leaveDays * base) / 26);
  return { month, year, daysPresent, fullMonth, proratedBase, leaveDays, leaveIndemnity, totalGross: proratedBase + leaveIndemnity };
}
