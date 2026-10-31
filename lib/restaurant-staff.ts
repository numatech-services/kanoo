import { Types } from "mongoose";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityStockMoveModel } from "@/models/ActivityStockMove";
import { EmployeeModel } from "@/models/Employee";
import { PayslipModel } from "@/models/Payslip";
import { StaffShiftModel } from "@/models/StaffShift";
import { BusinessRuleError } from "@/lib/errors";
import { monthBounds } from "@/lib/restaurant";
import type { TokenPayload } from "@/lib/auth";

type Id = Types.ObjectId;
const oid = (v: unknown) => new Types.ObjectId(String(v));
/**
 * Heures mensuelles de référence pour le coût horaire : 40 h par semaine ×
 * 52 ÷ 12. Base à confirmer selon les contrats de l'organisation.
 */
export const MONTHLY_HOURS = 173.33;
export const SERVICES = { midi: "Midi", soir: "Soir", jour: "Journée" } as const;
type Svc = keyof typeof SERVICES;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Durée d'un poste en heures (un service qui finit après minuit compte jusqu'au lendemain). */
export function shiftHours(start: string, end: string): number {
  const m = (t: string) => { const [h, mi] = t.split(":").map(Number); return h * 60 + mi; };
  const d = m(end) - m(start);
  return Math.round(((d > 0 ? d : d + 24 * 60) / 60) * 100) / 100;
}
const realHours = (s: { clockIn?: Date; clockOut?: Date }) =>
  s.clockIn && s.clockOut && s.clockOut > s.clockIn ? Math.round(((s.clockOut.getTime() - s.clockIn.getTime()) / 3_600_000) * 100) / 100 : null;

const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Planning d'une semaine (à partir du jour donné) : postes et équipe du restaurant. */
export async function weekPlanning(tenantId: string, deskId: string, start: string) {
  const end = addDays(start, 6);
  const [desk, shifts] = await Promise.all([
    ActivityDeskModel.findOne({ _id: deskId, tenantId }).select("staff").lean<{ staff?: Array<{ employeeId: Id; share: number; from?: string; to?: string }> } | null>(),
    StaffShiftModel.find({ tenantId, deskId, day: { $gte: start, $lte: end } }).sort({ day: 1, start: 1 }).lean<Array<{ _id: Id; employeeId: Id; day: string; service: Svc; start: string; end: string; clockIn?: Date; clockOut?: Date; absent?: boolean; note?: string }>>(),
  ]);
  const ids = [...new Set([...(desk?.staff ?? []).filter(s => (!s.to || s.to >= start) && (!s.from || s.from <= end)).map(s => String(s.employeeId)), ...shifts.map(s => String(s.employeeId))])];
  const emps = await EmployeeModel.find({ tenantId, _id: { $in: ids } }).select("firstName lastName position").lean<Array<{ _id: Id; firstName: string; lastName: string; position?: string }>>();
  return {
    start, end, days: Array.from({ length: 7 }, (_, k) => addDays(start, k)),
    team: emps.map(e => ({ employeeId: String(e._id), name: `${e.lastName} ${e.firstName}`, position: e.position })).sort((a, b) => a.name.localeCompare(b.name)),
    shifts: shifts.map(s => ({ ...s, _id: String(s._id), employeeId: String(s.employeeId), plannedHours: shiftHours(s.start, s.end), realHours: s.absent ? 0 : realHours(s) })),
  };
}

/** Crée ou remplace un poste (un par collaborateur, jour et service). */
export async function upsertShift(auth: TokenPayload, deskId: string, i: { employeeId: string; day: string; service: string; start: string; end: string; note?: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.day) || !HHMM.test(i.start) || !HHMM.test(i.end)) throw new BusinessRuleError("Jour ou horaires invalides (HH:MM).");
  if (i.start === i.end) throw new BusinessRuleError("Début et fin du poste identiques.");
  if (!(i.service in SERVICES)) throw new BusinessRuleError("Service inconnu (midi, soir, journée).");
  if (!(await EmployeeModel.exists({ _id: i.employeeId, tenantId: auth.tenantId }))) throw new BusinessRuleError("Collaborateur introuvable.");
  const clash = await StaffShiftModel.findOne({ tenantId: auth.tenantId, employeeId: i.employeeId, day: i.day, service: i.service, deskId: { $ne: deskId } }).select("_id").lean();
  if (clash) throw new BusinessRuleError("Ce collaborateur est déjà au planning d'un autre restaurant pour ce service.");
  await StaffShiftModel.updateOne({ tenantId: auth.tenantId, employeeId: i.employeeId, day: i.day, service: i.service },
    { $set: { deskId, start: i.start, end: i.end, ...(i.note !== undefined ? { note: String(i.note).slice(0, 200) } : {}) }, $setOnInsert: { createdBy: auth.userId } }, { upsert: true });
}

export async function deleteShift(auth: TokenPayload, deskId: string, id: string) {
  const r = await StaffShiftModel.deleteOne({ _id: id, tenantId: auth.tenantId, deskId, clockIn: { $exists: false } });
  if (r.deletedCount !== 1) throw new BusinessRuleError("Poste introuvable, ou déjà pointé (il ne se supprime plus : marquez une absence).");
}

/** Pointage : arrivée, départ, ou absence. */
export async function clock(auth: TokenPayload, deskId: string, id: string, action: "in" | "out" | "absent", at = new Date()) {
  const s = await StaffShiftModel.findOne({ _id: id, tenantId: auth.tenantId, deskId });
  if (!s) throw new BusinessRuleError("Poste introuvable.");
  if (action === "in") { if (s.clockIn) throw new BusinessRuleError("Arrivée déjà pointée."); s.clockIn = at; s.absent = false; }
  else if (action === "out") { if (!s.clockIn) throw new BusinessRuleError("Pointez d'abord l'arrivée."); if (s.clockOut) throw new BusinessRuleError("Départ déjà pointé."); s.clockOut = at; }
  else { if (s.clockIn) throw new BusinessRuleError("Poste déjà pointé : il ne peut pas devenir une absence."); s.absent = true; }
  await s.save();
}

/**
 * Le mois du personnel d'un restaurant : heures prévues et réelles par
 * collaborateur (réelles = pointées ; à défaut prévues), coût par service au
 * coût horaire (coût employeur du mois ÷ heures de référence), repas du
 * personnel du mois (avantage en nature à reporter sur le bulletin).
 * Coûts et repas : seulement pour qui gère la paie.
 */
export async function monthLabor(tenantId: string, deskId: string, month: string, payroll: boolean) {
  const b = monthBounds(month);
  const [shifts, meals] = await Promise.all([
    StaffShiftModel.find({ tenantId, deskId, day: { $gte: b.fromDay, $lte: b.toDay } }).lean<Array<{ employeeId: Id; service: Svc; start: string; end: string; clockIn?: Date; clockOut?: Date; absent?: boolean }>>(),
    payroll ? ActivityStockMoveModel.aggregate<{ _id: Id; value: number; n: number }>([
      { $match: { tenantId: oid(tenantId), deskId: oid(deskId), lossReason: "staff", employeeId: { $exists: true }, date: { $gte: b.from, $lte: b.to } } },
      { $group: { _id: "$employeeId", value: { $sum: "$lossValue" }, n: { $sum: 1 } } },
    ]) : Promise.resolve([]),
  ]);
  const ids = [...new Set([...shifts.map(s => String(s.employeeId)), ...meals.map(m => String(m._id))])];
  const [emps, slips] = await Promise.all([
    EmployeeModel.find({ tenantId, _id: { $in: ids } }).select("firstName lastName").lean<Array<{ _id: Id; firstName: string; lastName: string }>>(),
    payroll ? PayslipModel.find({ tenantId, year: b.year, month: b.m, employeeId: { $in: ids } }).select("employeeId employerCost grossTotal cnssEmployer").lean<Array<{ employeeId: Id; employerCost?: number; grossTotal?: number; cnssEmployer?: number }>>() : Promise.resolve([]),
  ]);
  const rate = new Map(slips.map(p => [String(p.employeeId), ((p.employerCost && p.employerCost > 0 ? p.employerCost : (p.grossTotal ?? 0) + (p.cnssEmployer ?? 0)) / MONTHLY_HOURS)]));
  const byService: Record<string, { planned: number; real: number; cost: number }> = {};
  const people = ids.map(id => {
    const own = shifts.filter(s => String(s.employeeId) === id);
    let planned = 0, real = 0, cost = 0, absences = 0;
    for (const s of own) {
      const p = shiftHours(s.start, s.end), r = s.absent ? 0 : realHours(s) ?? p;
      if (s.absent) absences++;
      planned += p; real += r;
      const c = (rate.get(id) ?? 0) * r;
      cost += c;
      const k = byService[s.service] ??= { planned: 0, real: 0, cost: 0 };
      k.planned += p; k.real += r; k.cost += c;
    }
    const e = emps.find(x => String(x._id) === id), meal = meals.find(m => String(m._id) === id);
    return {
      employeeId: id, name: e ? `${e.lastName} ${e.firstName}` : "—", plannedHours: Math.round(planned * 100) / 100, realHours: Math.round(real * 100) / 100, absences,
      ...(payroll ? { hourlyCost: rate.has(id) ? Math.round(rate.get(id)!) : null, cost: Math.round(cost), staffMeals: meal ? { value: Math.round(meal.value), count: meal.n } : null } : {}),
    };
  }).sort((a, b2) => a.name.localeCompare(b2.name));
  return {
    month, monthlyHours: MONTHLY_HOURS, people,
    services: Object.entries(byService).map(([k, v]) => ({ service: k, label: SERVICES[k as Svc], plannedHours: Math.round(v.planned * 100) / 100, realHours: Math.round(v.real * 100) / 100, ...(payroll ? { cost: Math.round(v.cost) } : {}) })),
  };
}
