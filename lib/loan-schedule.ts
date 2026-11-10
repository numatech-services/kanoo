/**
 * Tableau d'amortissement d'un emprunt : fonctions pures (testables, utilisables
 * à l'écran). Taux périodique proportionnel (taux annuel ÷ nombre d'échéances
 * par an) : c'est l'usage le plus courant ; si la banque remet un tableau
 * différent, chaque échéance non payée s'ajuste à la main.
 */
export const FREQUENCIES = {
  monthly: { label: "Mensuelle", perYear: 12, months: 1 },
  quarterly: { label: "Trimestrielle", perYear: 4, months: 3 },
  semiannual: { label: "Semestrielle", perYear: 2, months: 6 },
  annual: { label: "Annuelle", perYear: 1, months: 12 },
} as const;
export type Frequency = keyof typeof FREQUENCIES;

export const METHODS = {
  annuity: "Échéances constantes",
  constant: "Amortissement constant du capital",
  bullet: "Remboursement in fine",
} as const;
export type Method = keyof typeof METHODS;

export interface ScheduleInput {
  principal: number; annualRate: number; durationMonths: number; frequency: Frequency; method: Method;
  /** Échéances de différé : intérêts seuls, capital ensuite. */
  deferralPeriods?: number;
  firstDueDate: Date; insurancePerPeriod?: number;
}
export interface Installment { n: number; dueDate: Date; principal: number; interest: number; insurance: number; total: number; remaining: number }

/** Date d'échéance n (0 = première) : le jour est gardé, ramené au dernier jour d'un mois plus court. */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

export function periodsOf(durationMonths: number, frequency: Frequency) {
  return Math.round(durationMonths / FREQUENCIES[frequency].months);
}

export function buildSchedule(i: ScheduleInput): Installment[] {
  const f = FREQUENCIES[i.frequency];
  const n = periodsOf(i.durationMonths, i.frequency);
  const d = Math.min(Math.max(0, Math.round(i.deferralPeriods ?? 0)), n - 1);
  const r = i.annualRate / f.perYear;
  const amortized = n - d;
  const annuity = r === 0 ? i.principal / amortized : i.principal * r / (1 - Math.pow(1 + r, -amortized));
  const out: Installment[] = [];
  let remaining = i.principal;
  for (let k = 0; k < n; k++) {
    const interest = Math.round(remaining * r);
    let principal = 0;
    if (k >= d) {
      if (i.method === "annuity") principal = Math.round(annuity) - interest;
      else if (i.method === "constant") principal = Math.round(i.principal / amortized);
      else principal = 0;
    }
    if (k === n - 1) principal = remaining;
    principal = Math.min(Math.max(0, principal), remaining);
    remaining -= principal;
    const insurance = Math.round(i.insurancePerPeriod ?? 0);
    out.push({ n: k + 1, dueDate: addMonths(i.firstDueDate, k * f.months), principal, interest, insurance, total: principal + interest + insurance, remaining });
  }
  return out;
}

/** Totaux du tableau : coût du crédit = intérêts + assurance. */
export function scheduleTotals(s: Array<{ principal: number; interest: number; insurance: number }>) {
  return s.reduce((t, x) => ({ principal: t.principal + x.principal, interest: t.interest + x.interest, insurance: t.insurance + x.insurance }), { principal: 0, interest: 0, insurance: 0 });
}
