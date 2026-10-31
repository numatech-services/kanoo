import { ActivityDeskModel } from "@/models/ActivityDesk";
import { EmployeeModel } from "@/models/Employee";
import { BusinessRuleError } from "@/lib/errors";

const isId = (v: unknown) => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);

/**
 * Personnel affecté à un comptoir, contrôlé : identifiants de collaborateurs de
 * l'organisation, pas de doublon, part de temps entre 1 et 100 %, et jamais
 * plus de 100 % du temps d'une personne sur l'ensemble des comptoirs.
 */
export async function validateStaff(tenantId: string, deskId: string, raw: unknown): Promise<Array<{ employeeId: string; share: number; from?: string; to?: string }>> {
  const list = Array.isArray(raw) ? raw as Array<{ employeeId?: unknown; share?: unknown; from?: unknown; to?: unknown }> : [];
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const staff = list.filter(x => isId(x.employeeId) && Number(x.share) > 0).map(x => ({ employeeId: String(x.employeeId), share: Math.min(1, Math.round(Number(x.share) * 100) / 100), ...(day(x.from) ? { from: day(x.from) } : {}), ...(day(x.to) ? { to: day(x.to) } : {}) }));
  if (staff.some(x => x.from && x.to && x.to < x.from)) throw new BusinessRuleError("Fin d'affectation avant son début.");
  // Une même personne peut figurer deux fois si ses périodes ne se chevauchent pas (changement de part de temps).
  const overlap = (a: { from?: string; to?: string }, b: { from?: string; to?: string }) => (a.from ?? "0000") <= (b.to ?? "9999") && (b.from ?? "0000") <= (a.to ?? "9999");
  if (staff.some((x, i) => staff.some((y, j) => j > i && y.employeeId === x.employeeId && overlap(x, y)))) throw new BusinessRuleError("Un employé figure deux fois sur des périodes qui se chevauchent.");
  const ids = [...new Set(staff.map(x => x.employeeId))];
  if (ids.length && (await EmployeeModel.countDocuments({ _id: { $in: ids }, tenantId })) !== ids.length) throw new BusinessRuleError("Employé introuvable.");
  const others = await ActivityDeskModel.find({ tenantId, _id: { $ne: deskId }, archived: { $ne: true }, "staff.employeeId": { $in: staff.map(x => x.employeeId) } }).select("staff").lean<Array<{ staff?: Array<{ employeeId: unknown; share: number; from?: string; to?: string }> }>>();
  for (const x of staff) {
    // Seules les affectations ailleurs qui chevauchent la période comptent.
    const elsewhere = others.reduce((t, d) => t + (d.staff ?? []).filter(y => String(y.employeeId) === x.employeeId && overlap(x, y)).reduce((u, y) => u + y.share, 0), 0);
    if (elsewhere + x.share > 1.0001) throw new BusinessRuleError(`Un employé serait affecté à ${Math.round((elsewhere + x.share) * 100)} % de son temps (déjà ${Math.round(elsewhere * 100)} % sur d'autres comptoirs).`);
  }
  return staff;
}
