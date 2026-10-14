/**
 * Appels d'offres auxquels l'organisation répond : règles de rappel avant la
 * date limite de dépôt. Pur, donc testable.
 */

export const OPEN_APPEL_STATUSES = ["identified", "preparing"] as const;

/** Jours restants avant la date limite, arrondis au jour (0 = c'est aujourd'hui). */
export function daysUntil(deadline: Date | string, now = new Date()): number {
  const d = new Date(deadline); d.setHours(0, 0, 0, 0);
  const t = new Date(now); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

/** Les rappels partent à J-7, J-3, J-1 et le jour même — pas tous les jours, pour ne pas lasser. */
export const REMINDER_DAYS = [7, 3, 1, 0];
export function reminderDue(deadline: Date | string, now = new Date()): boolean {
  return REMINDER_DAYS.includes(daysUntil(deadline, now));
}

export function reminderMessage(a: { title: string; reference?: string; organism?: string; requiredDocuments?: Array<{ provided: boolean }> }, left: number): string {
  const when = left === 0 ? "aujourd'hui" : left === 1 ? "demain" : `dans ${left} jours`;
  const missing = (a.requiredDocuments ?? []).filter(d => !d.provided).length;
  const ref = a.reference ? ` (${a.reference})` : "";
  const from = a.organism ? ` — ${a.organism}` : "";
  return `Dépôt ${when} : « ${a.title} »${ref}${from}.${missing ? ` ${missing} pièce${missing > 1 ? "s" : ""} encore à réunir.` : " Dossier complet."}`;
}
