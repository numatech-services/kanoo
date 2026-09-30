import { Types } from "mongoose";
import { LeaveModel } from "@/models/Leave";

export { LEAVE_TYPES, MONTHLY_ACCRUAL } from "@/lib/leave-types";
import { MONTHLY_ACCRUAL } from "@/lib/leave-types";

/** Jours ouvrables entre deux dates incluses (lundi → samedi), demi-journées déduites. */
export function workingDays(start: Date, end: Date, halfStart = false, halfEnd = false): number {
  const a = new Date(start); a.setHours(0, 0, 0, 0);
  const b = new Date(end); b.setHours(0, 0, 0, 0);
  if (b < a) return 0;
  let n = 0;
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n++;
  if (halfStart && a.getDay() !== 0) n -= 0.5;
  if (halfEnd && b.getDay() !== 0 && b.getTime() !== a.getTime()) n -= 0.5;
  return Math.max(0, n);
}

/** Mois complets de service entre l'entrée et une date. */
export function serviceMonths(startDate: Date, at = new Date()): number {
  const s = new Date(startDate);
  let m = (at.getFullYear() - s.getFullYear()) * 12 + (at.getMonth() - s.getMonth());
  if (at.getDate() < s.getDate()) m -= 1;
  return Math.max(0, m);
}

/** Solde de congés annuels : acquis (2,5 j/mois + reprise) − pris (approuvés) − demandés en attente. */
export async function leaveBalance(tenantId: string, employee: { _id: unknown; startDate: Date; leaveOpeningBalance?: number }) {
  const acquired = Math.round((serviceMonths(employee.startDate) * MONTHLY_ACCRUAL + (employee.leaveOpeningBalance ?? 0)) * 10) / 10;
  const rows = await LeaveModel.aggregate<{ _id: string; days: number }>([
    { $match: { tenantId: new Types.ObjectId(tenantId), employeeId: new Types.ObjectId(String(employee._id)), type: "annual", status: { $in: ["approved", "pending"] } } },
    { $group: { _id: "$status", days: { $sum: "$days" } } },
  ]);
  const taken = rows.find(r => r._id === "approved")?.days ?? 0;
  const pending = rows.find(r => r._id === "pending")?.days ?? 0;
  return { acquired, taken, pending, available: Math.round((acquired - taken - pending) * 10) / 10 };
}
