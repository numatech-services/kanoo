/**
 * Retenue de garantie des marchés — règles pures.
 *
 * Sur chaque facture de travaux, le maître d'ouvrage garde une part du TTC
 * (5 % en général, 10 % au plus) jusqu'à la réception définitive, qui clôt le
 * délai de garantie (douze mois après la réception provisoire, d'ordinaire).
 * Cette part reste due, mais n'est pas exigible : elle quitte le compte client
 * ordinaire (411) pour le compte 4117, et ne doit ni être relancée ni compter
 * comme un retard. Une caution bancaire peut la remplacer : le taux est alors 0.
 */

export const RETENTION_ACCOUNT = { accountCode: "411700", accountLabel: "Clients, retenues de garantie" };
export const MAX_RETENTION_RATE = 0.1;

/** Retenue d'une facture de travaux : `rate` × TTC, arrondie au franc. Rien sur un acompte. */
export function retentionFor(totalTTC: number, rate: number, kind?: string): number {
  if (kind === "deposit" || !(rate > 0) || !(totalTTC > 0)) return 0;
  return Math.round(totalTTC * Math.min(rate, MAX_RETENTION_RATE));
}

/** Date à partir de laquelle la retenue peut être réclamée. */
export function releasableFrom(c: { receptionDefinitiveDate?: Date | string | null; receptionProvisoireDate?: Date | string | null; guaranteeMonths?: number }): Date | null {
  if (c.receptionDefinitiveDate) return new Date(c.receptionDefinitiveDate);
  if (!c.receptionProvisoireDate) return null;
  const d = new Date(c.receptionProvisoireDate);
  d.setMonth(d.getMonth() + (c.guaranteeMonths ?? 12));
  return d;
}

export interface RetentionState {
  /** Total retenu sur les factures du marché (hors factures annulées). */
  held: number;
  /** Déjà reversé par le client. */
  released: number;
  /** Reste à récupérer. */
  outstanding: number;
  releasableFrom: string | null;
  /** Réclamable aujourd'hui : reste dû et délai de garantie écoulé. */
  claimable: boolean;
}

export function retentionState(
  invoices: Array<{ retentionAmount?: number; status?: string }>,
  contract: { retentionReleases?: Array<{ amount: number }>; receptionDefinitiveDate?: Date | string | null; receptionProvisoireDate?: Date | string | null; guaranteeMonths?: number },
  now = new Date(),
): RetentionState {
  const held = invoices.filter(i => i.status !== "cancelled").reduce((t, i) => t + (i.retentionAmount ?? 0), 0);
  const released = (contract.retentionReleases ?? []).reduce((t, r) => t + r.amount, 0);
  const outstanding = Math.max(0, held - released);
  const from = releasableFrom(contract);
  return { held, released, outstanding, releasableFrom: from ? from.toISOString() : null, claimable: outstanding > 0 && !!from && from <= now };
}
