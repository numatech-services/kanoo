import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { TokenPayload } from "@/lib/auth";
import { authCan, ALERT_MANAGER_ROLES, effectiveRoles, isServiceRole, rolesCanPerform } from "@/lib/role-resources";
import type { UserRole } from "@/types";
import { AlertModel, type AlertDoc } from "@/models/Alert";
import { ContractModel } from "@/models/Contract";
import { UserModel } from "@/models/User";
import { registrationWatch, REGISTRATION_WATCH_FIELDS, registrationFollowUp, registrationReminderText, type RegistrationWatchLike } from "@/lib/registration";
import { DASHBOARD_HORIZON_DAYS, alertTone, daysLeft, normalizeRemindDays } from "@/lib/alerts";

/**
 * Lecture des alertes, avec le cloisonnement :
 *  - qui peut créer des alertes (direction, comptabilité, administration) les
 *    voit toutes ;
 *  - les autres ne voient que celles dont ils sont destinataires.
 */

/**
 * Destinataires par défaut : ceux qui gèrent les alertes (direction,
 * comptabilité, administration), une seule liste pour les droits et les
 * rappels — le super-administrateur de la plateforme excepté.
 */
export const DEFAULT_RECIPIENT_ROLES: string[] = ALERT_MANAGER_ROLES.filter(r => r !== "superadmin");

type AuthLike = Pick<TokenPayload, "tenantId" | "userId" | "role" | "roles" | "allowedResources" | "roleLevels">;

export const canManageAlerts = (auth: AuthLike) => authCan(auth, "alerts", "create");

export function alertScope(auth: AuthLike): Record<string, unknown> {
  const base = { tenantId: new Types.ObjectId(auth.tenantId) };
  return canManageAlerts(auth) ? base : { ...base, assigneeIds: new Types.ObjectId(auth.userId) };
}

/**
 * Supervision : modifier, annuler ou rouvrir l'alerte d'un autre. Direction et
 * comptabilité principale, ou chef de service ; un employé ne modifie que les
 * siennes.
 */
export function canSuperviseAlerts(auth: AuthLike): boolean {
  const roles = effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined);
  if (roles.includes("superadmin" as UserRole)) return true;
  return roles.some(r => rolesCanPerform([r], "alerts", "create", auth.allowedResources, auth.roleLevels as never)
    && (!isServiceRole(r) || (auth.roleLevels as Record<string, string> | undefined)?.[r] === "chef"));
}

type Recipient = { _id: Types.ObjectId; email?: string; firstName?: string };
type UserRow = Recipient & { role?: string; roles?: string[]; roleLevels?: Record<string, string>; allowedResources?: string[] };
const USER_FIELDS = "_id email firstName role roles roleLevels allowedResources";
const asAuth = (u: UserRow) => ({ role: u.role ?? "", roles: u.roles, roleLevels: u.roleLevels as never, allowedResources: u.allowedResources });

/**
 * Utilisateurs à prévenir (actifs, de l'organisation, et qui peuvent ouvrir
 * l'écran des alertes — niveau et liste d'accès individuelle compris) :
 *  - les destinataires nommés ;
 *  - la direction et la comptabilité s'il n'y en a pas, si tous sont devenus
 *    inactifs, ou quand `escalate` (jour J et retard) : une démarche confiée à
 *    un collaborateur qui l'oublie ne doit pas laisser tomber la pénalité.
 */
export async function alertRecipients(a: Pick<AlertDoc, "tenantId" | "assigneeIds">, escalate = false): Promise<Recipient[]> {
  const named = a.assigneeIds?.length
    ? (await UserModel.find({ tenantId: a.tenantId, isActive: true, _id: { $in: a.assigneeIds } }).select(USER_FIELDS).lean<UserRow[]>())
      .filter(u => authCan(asAuth(u), "alerts", "read"))
    : [];
  const managers = !named.length || escalate
    ? (await UserModel.find({ tenantId: a.tenantId, isActive: true, $or: [{ role: { $in: DEFAULT_RECIPIENT_ROLES } }, { roles: { $in: DEFAULT_RECIPIENT_ROLES } }] }).select(USER_FIELDS).lean<UserRow[]>())
      .filter(u => authCan(asAuth(u), "alerts", "create"))
    : [];
  const byId = new Map<string, Recipient>();
  for (const u of [...named, ...managers]) byId.set(String(u._id), { _id: u._id, email: u.email, firstName: u.firstName });
  return [...byId.values()];
}

/**
 * Destinataires valides : utilisateurs actifs de l'organisation, sans doublon.
 * `keep` : destinataires déjà enregistrés ; s'ils sont devenus inactifs, ils
 * sont retirés sans erreur (sinon l'alerte ne se modifiait plus).
 */
export async function checkAssignees(tenantId: string, raw: unknown, keep: unknown[] = []): Promise<{ ids: Types.ObjectId[]; dropped: number } | { error: string }> {
  if (raw === undefined || raw === null) return { ids: [], dropped: 0 };
  if (!Array.isArray(raw) || raw.some(v => typeof v !== "string")) return { error: "Destinataires : une liste d'utilisateurs est attendue." };
  const uniq = [...new Set(raw as string[])].slice(0, 50);
  if (uniq.some(id => !Types.ObjectId.isValid(id))) return { error: "Destinataire invalide." };
  if (!uniq.length) return { ids: [], dropped: 0 };
  const active = new Set((await UserModel.find({ tenantId, isActive: true, _id: { $in: uniq } }).select("_id").lean<Array<{ _id: Types.ObjectId }>>()).map(u => String(u._id)));
  const kept = new Set(keep.map(String));
  const missing = uniq.filter(id => !active.has(id));
  if (missing.some(id => !kept.has(id))) return { error: "Un destinataire n'appartient pas à l'organisation ou n'est plus actif." };
  return { ids: uniq.filter(id => active.has(id)).map(id => new Types.ObjectId(id)), dropped: missing.length };
}

export interface BoardItem {
  id: string;
  title: string;
  dueDate: string;
  left: number;
  tone: "neg" | "warn" | "info";
  consequence?: string;
  href: string;
  /** Échéance calculée par Kanoo (enregistrement d'un marché), pas saisie. */
  auto: boolean;
}

/**
 * Droits d'enregistrement des marchés clients non encore payés : un mois
 * après l'approbation, ou la signature à défaut (lib/registration). Même
 * règle que le rappel automatique « registration-due » et le brief du jour.
 */
export async function pendingRegistrations(tenantId: string, now = new Date(), horizonDays = DASHBOARD_HORIZON_DAYS): Promise<BoardItem[]> {
  const list = await ContractModel.find({ tenantId, ...registrationWatch() }).select(REGISTRATION_WATCH_FIELDS)
    .lean<Array<RegistrationWatchLike & { _id: Types.ObjectId; reference: string; title: string }>>();
  const out: BoardItem[] = [];
  for (const c of list) {
    const f = registrationFollowUp(c, now);
    if (!f || f.daysLeft > horizonDays) continue;
    out.push({
      id: `reg-${String(c._id)}`, title: `Enregistrer le marché ${c.reference}`, dueDate: f.due.toISOString(), left: f.daysLeft, tone: alertTone(f.daysLeft),
      consequence: registrationReminderText(c.buyerType), href: `/contracts/${String(c._id)}`, auto: true,
    });
  }
  return out;
}

/** Alertes ouvertes qui tombent dans l'horizon (ou celui de leurs rappels). */
export async function openAlertsDue(auth: AuthLike, now = new Date()): Promise<BoardItem[]> {
  const rows = await AlertModel.find({ ...alertScope(auth), status: "open", dueDate: { $lte: new Date(now.getTime() + 366 * 86_400_000) } })
    .select("title dueDate consequence remindDays").sort({ dueDate: 1 }).limit(500)
    .lean<Array<Pick<AlertDoc, "_id" | "title" | "dueDate" | "consequence" | "remindDays">>>();
  return rows
    .map(a => ({ a, left: daysLeft(a.dueDate, now), horizon: Math.max(DASHBOARD_HORIZON_DAYS, ...normalizeRemindDays(a.remindDays)) }))
    .filter(x => x.left <= x.horizon)
    .map(({ a, left }) => ({
      id: String(a._id), title: a.title, dueDate: new Date(a.dueDate).toISOString(), left, tone: alertTone(left),
      consequence: a.consequence || undefined, href: `/alertes?alerte=${String(a._id)}`, auto: false,
    }));
}

export interface AlertsBoard { items: BoardItem[]; overdue: number; total: number; canManage: boolean }

/**
 * Bloc « Alertes et échéances » du tableau de bord : alertes saisies + droits
 * d'enregistrement à payer, triés par date. null si le compte n'a rien à voir.
 */
export async function alertsBoard(auth: AuthLike, can: (resource: string) => boolean, now = new Date(), limit = 6): Promise<AlertsBoard | null> {
  if (!can("alerts")) return null;
  await connectDB();
  const [manual, auto] = await Promise.all([
    openAlertsDue(auth, now).catch(() => [] as BoardItem[]),
    can("contracts") && can("invoices") ? pendingRegistrations(auth.tenantId, now).catch(() => [] as BoardItem[]) : Promise.resolve([] as BoardItem[]),
  ]);
  const all = [...manual, ...auto].sort((a, b) => a.left - b.left || a.title.localeCompare(b.title, "fr"));
  const canManage = canManageAlerts(auth);
  if (!all.length && !canManage) return null;
  return { items: all.slice(0, limit), overdue: all.filter(i => i.left < 0).length, total: all.length, canManage };
}
