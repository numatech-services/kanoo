/**
 * Cautions bancaires — règles pures (libellés, échéances, engagements).
 */
import type { GuaranteeType } from "@/models/BankGuarantee";

export const GUARANTEE_TYPES: Record<GuaranteeType, string> = {
  soumission: "Caution de soumission",
  bonne_execution: "Caution de bonne exécution",
  avance_demarrage: "Caution de restitution d'avance",
  retenue_garantie: "Caution de retenue de garantie",
  garantie_emprunt: "Garantie d'emprunt (hypothèque, nantissement, aval)",
  autre: "Autre caution",
};
export const FEE_PERIODS = { once: { label: "Une fois (à l'émission)", months: 0 }, quarterly: { label: "Trimestrielle", months: 3 }, semiannual: { label: "Semestrielle", months: 6 }, annual: { label: "Annuelle", months: 12 } } as const;
export const CHARGE_KINDS = { commission: "Commission", prorogation: "Frais de prorogation", dossier: "Frais de dossier", autre: "Autres frais" } as const;

/**
 * Prochaine commission périodique : échéances tous les `months` mois depuis
 * l'émission, la première non encore passée (et pas au-delà de l'échéance).
 * Montant : montant garanti × taux annuel × durée de la période.
 */
export function nextCommission(g: { amount: number; issueDate: Date | string; expiryDate?: Date | string | null; status?: string; direction?: string; feeRate?: number; feePeriod?: string; charges?: Array<{ kind: string; date: Date | string }> }, limit = 1) {
  const p = FEE_PERIODS[(g.feePeriod ?? "once") as keyof typeof FEE_PERIODS];
  if (!p || !p.months || !(g.feeRate && g.feeRate > 0) || g.status !== "active" || g.direction === "received") return [];
  const charged = (g.charges ?? []).filter(c => c.kind === "commission").length;
  const amount = Math.round(g.amount * g.feeRate * p.months / 12);
  const out: Array<{ date: Date; amount: number; period: number }> = [];
  const start = new Date(g.issueDate);
  for (let k = charged + 1; out.length < limit && k < charged + 1 + 200; k++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k * p.months, start.getUTCDate()));
    if (g.expiryDate && d > new Date(g.expiryDate)) break;
    out.push({ date: d, amount, period: k });
  }
  return out;
}

/** Coût total d'une caution : commission d'émission et frais passés depuis. */
export const guaranteeCost = (g: { fee?: number; charges?: Array<{ amount: number }> }) => (g.fee ?? 0) + (g.charges ?? []).reduce((t, c) => t + c.amount, 0);

/** Comptes : commission (frais bancaires), dépôt bloqué, perte en cas d'appel. */
export const GUARANTEE_FEE_ACCOUNT = { accountCode: "631000", accountLabel: "Frais bancaires" };
export const GUARANTEE_DEPOSIT_ACCOUNT = { accountCode: "275000", accountLabel: "Dépôts et cautionnements versés" };
export const GUARANTEE_CALL_ACCOUNT = { accountCode: "658000", accountLabel: "Charges diverses" };

/** Jours restants avant l'échéance (négatif : échue). */
export function daysToExpiry(expiry: Date | string | undefined | null, now = new Date()): number | null {
  if (!expiry) return null;
  const d = new Date(expiry); d.setHours(0, 0, 0, 0);
  const t = new Date(now); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

/** Rappel à 30, 15 et 7 jours, puis le lendemain de l'échéance (mainlevée à demander). */
export const GUARANTEE_REMINDER_DAYS = [30, 15, 7, -1];

/**
 * Une caution échue reste en cours tant que la mainlevée n'est pas obtenue :
 * la banque continue de facturer sa commission et d'immobiliser le dépôt.
 */
export function guaranteeAlert(g: { status: string; expiryDate?: Date | string | null }, now = new Date()): "expired" | "expiring" | null {
  if (g.status !== "active") return null;
  const left = daysToExpiry(g.expiryDate, now);
  if (left === null) return null;
  if (left < 0) return "expired";
  if (left <= 30) return "expiring";
  return null;
}

/** Engagements hors bilan : total des cautions en cours, par type. */
export function commitments(list: Array<{ type: GuaranteeType; amount: number; status: string; collateral?: number; direction?: string }>) {
  const received = list.filter(g => g.status === "active" && g.direction === "received");
  const active = list.filter(g => g.status === "active" && g.direction !== "received");
  const byType = Object.fromEntries((Object.keys(GUARANTEE_TYPES) as GuaranteeType[]).map(t => [t, active.filter(g => g.type === t).reduce((s, g) => s + g.amount, 0)]));
  return { received: received.reduce((s, g) => s + g.amount, 0), receivedCount: received.length, total: active.reduce((s, g) => s + g.amount, 0), collateral: active.reduce((s, g) => s + (g.collateral ?? 0), 0), count: active.length, byType };
}
