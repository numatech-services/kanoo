/**
 * Échéancier de paiement d'une facture (calcul pur, utilisable à l'écran).
 *
 * Une facture peut se régler en plusieurs versements datés. Les règlements
 * s'imputent sur les versements dans l'ordre : l'échéance « en cours » est la
 * première qui n'est pas entièrement couverte. Relances et retards se lisent
 * sur elle, plus sur l'échéance unique de la facture.
 */

export interface Installment { dueDate: Date | string; amount: number; label?: string }

export interface InstallmentLike {
  totalTTC: number; paidAmount?: number; creditedAmount?: number; retentionAmount?: number; status?: string;
  dueDate?: Date | string | null;
  installments?: Installment[];
}

/** Montant à échelonner : TTC − avoirs − retenue de garantie (non exigible). */
export function scheduleBase(i: InstallmentLike): number {
  const retention = i.status === "cancelled" ? 0 : i.retentionAmount ?? 0;
  return Math.max(0, Math.round(i.totalTTC - (i.creditedAmount ?? 0) - retention));
}

/** Contrôle d'un échéancier : dates valides et croissantes, montants positifs, total exact. */
export function validateSchedule(base: number, list: Installment[]): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (list.length > 36) return "36 versements au plus.";
  let prev = -Infinity, sum = 0;
  for (const [k, x] of list.entries()) {
    const t = new Date(x.dueDate).getTime();
    if (isNaN(t)) return `Date du versement ${k + 1} invalide.`;
    if (t <= prev) return "Les versements doivent se suivre dans le temps.";
    if (!(Math.round(x.amount) > 0)) return `Montant du versement ${k + 1} invalide.`;
    prev = t; sum += Math.round(x.amount);
  }
  if (sum !== base) return `Le total des versements (${sum.toLocaleString("fr-FR")}) doit égaler le montant dû de la facture (${base.toLocaleString("fr-FR")} FCFA).`;
  return null;
}

/** Échéancier en n versements égaux (le dernier absorbe l'arrondi), tous les `months` mois. */
export function splitEvenly(base: number, n: number, first: Date, months = 1): Installment[] {
  const k = Math.max(1, Math.min(36, Math.floor(n)));
  const part = Math.floor(base / k);
  return Array.from({ length: k }, (_, i) => {
    const d = new Date(first); d.setMonth(d.getMonth() + i * months);
    return { dueDate: d, amount: i === k - 1 ? base - part * (k - 1) : part, label: `Versement ${i + 1}/${k}` };
  });
}

export interface ScheduleState {
  /** Échéance en cours (première non couverte), ou celle de la facture sans échéancier. */
  currentDueDate: Date | null;
  currentIndex: number | null;
  /** Montant exigible à la date (versements échus − règlements). */
  dueNow: number;
  rows: Array<{ dueDate: Date; amount: number; label?: string; covered: number; status: "paid" | "partial" | "due" | "late" }>;
}

export function scheduleState(i: InstallmentLike, asOf = new Date()): ScheduleState {
  const paid = Math.max(0, i.paidAmount ?? 0);
  if (!i.installments?.length) {
    const rest = Math.max(0, scheduleBase(i) - paid);
    const due = i.dueDate ? new Date(i.dueDate) : null;
    return { currentDueDate: rest > 0 ? due : null, currentIndex: null, dueNow: due && due <= asOf ? rest : 0, rows: [] };
  }
  let left = paid, current: number | null = null, dueNow = 0;
  const rows = i.installments.map((x, k) => {
    const covered = Math.min(x.amount, left); left -= covered;
    const d = new Date(x.dueDate);
    if (covered < x.amount && current === null) current = k;
    if (d <= asOf) dueNow += x.amount - covered;
    const status: "paid" | "partial" | "due" | "late" = covered >= x.amount ? "paid" : d <= asOf ? "late" : covered > 0 ? "partial" : "due";
    return { dueDate: d, amount: x.amount, label: x.label, covered, status };
  });
  return { currentDueDate: current === null ? null : rows[current].dueDate, currentIndex: current, dueNow: Math.round(dueNow), rows };
}
