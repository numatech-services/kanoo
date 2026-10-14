/**
 * Cautions bancaires — règles pures (libellés, échéances, engagements).
 */
import type { GuaranteeType } from "@/models/BankGuarantee";

export const GUARANTEE_TYPES: Record<GuaranteeType, string> = {
  soumission: "Caution de soumission",
  bonne_execution: "Caution de bonne exécution",
  avance_demarrage: "Caution de restitution d'avance",
  retenue_garantie: "Caution de retenue de garantie",
  autre: "Autre caution",
};

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
export function commitments(list: Array<{ type: GuaranteeType; amount: number; status: string; collateral?: number }>) {
  const active = list.filter(g => g.status === "active");
  const byType = Object.fromEntries((Object.keys(GUARANTEE_TYPES) as GuaranteeType[]).map(t => [t, active.filter(g => g.type === t).reduce((s, g) => s + g.amount, 0)]));
  return { total: active.reduce((s, g) => s + g.amount, 0), collateral: active.reduce((s, g) => s + (g.collateral ?? 0), 0), count: active.length, byType };
}
