import { Types } from "mongoose";
import { LeaveModel } from "@/models/Leave";

export { LEAVE_TYPES, MONTHLY_ACCRUAL } from "@/lib/leave-types";
import { MONTHLY_ACCRUAL } from "@/lib/leave-types";
import { dateKey } from "@/lib/holidays";

/**
 * Jours ouvrables entre deux dates incluses (lundi → samedi), jours fériés
 * exclus, demi-journées déduites. Seuls les dimanches étaient retirés : un
 * congé couvrant la Tabaski ou le 3 août consommait ces jours.
 */
export function workingDays(start: Date, end: Date, halfStart = false, halfEnd = false, holidays: Set<string> = new Set()): number {
  const a = new Date(start); a.setHours(0, 0, 0, 0);
  const b = new Date(end); b.setHours(0, 0, 0, 0);
  if (b < a) return 0;
  const off = (d: Date) => d.getDay() === 0 || holidays.has(dateKey(d));
  let n = 0;
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) if (!off(d)) n++;
  if (halfStart && !off(a)) n -= 0.5;
  if (halfEnd && !off(b) && b.getTime() !== a.getTime()) n -= 0.5;
  return Math.max(0, n);
}

/** Mois complets de service entre l'entrée et une date. */
export function serviceMonths(startDate: Date, at = new Date()): number {
  const s = new Date(startDate);
  let m = (at.getFullYear() - s.getFullYear()) * 12 + (at.getMonth() - s.getMonth());
  if (at.getDate() < s.getDate()) m -= 1;
  return Math.max(0, m);
}

/**
 * Solde de congés annuels : acquis (2,5 j/mois + reprise) − pris (approuvés)
 * − demandés en attente, à une date. `maxBalanceDays` (règle de
 * l'organisation) plafonne le report : au-delà, les jours anciens non pris
 * sont perdus — l'acquis retenu est ramené à pris + plafond.
 */
export async function leaveBalance(tenantId: string, employee: { _id: unknown; startDate: Date; leaveOpeningBalance?: number }, opts: { at?: Date; maxBalanceDays?: number } = {}) {
  const earned = Math.round((serviceMonths(employee.startDate, opts.at ?? new Date()) * MONTHLY_ACCRUAL + (employee.leaveOpeningBalance ?? 0)) * 10) / 10;
  const rows = await LeaveModel.aggregate<{ _id: string; days: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), employeeId: new Types.ObjectId(String(employee._id)), type: "annual", status: { $in: ["approved", "pending"] } } },
    { $group: { _id: "$status", days: { $sum: "$days" } } },
  ]);
  const taken = rows.find(r => r._id === "approved")?.days ?? 0;
  const pending = rows.find(r => r._id === "pending")?.days ?? 0;
  const cap = opts.maxBalanceDays && opts.maxBalanceDays > 0 ? opts.maxBalanceDays : null;
  const acquired = cap !== null ? Math.min(earned, taken + cap) : earned;
  return { acquired, taken, pending, available: Math.round((acquired - taken - pending) * 10) / 10, ...(cap !== null && earned > acquired ? { forfeited: Math.round((earned - acquired) * 10) / 10, cap } : {}) };
}

/** Règles RH de l'organisation (plafond de report, jours fériés ajoutés / retirés). */
export async function hrPolicy(tenantId: string) {
  const { TenantModel } = await import("@/models/Tenant");
  const t = await TenantModel.findById(tenantId).select("hrPolicy").lean<{ hrPolicy?: { leaveMaxBalanceDays?: number; extraHolidays?: Array<{ date: string; label: string }>; removedHolidays?: string[] } } | null>();
  const p = t?.hrPolicy ?? {};
  return { maxBalanceDays: p.leaveMaxBalanceDays || undefined, holidays: { extra: p.extraHolidays ?? [], removed: p.removedHolidays ?? [] } };
}
