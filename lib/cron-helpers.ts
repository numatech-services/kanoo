import mongoose from "mongoose";
import { NotificationModel } from "@/models/Notification";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { buildSessionPayload } from "@/lib/session";
import type { TokenPayload } from "@/lib/auth";

/**
 * Briques communes aux tâches planifiées (lib/cron-jobs.ts,
 * lib/automation-jobs.ts) : notifier, trouver les destinataires d'un rôle,
 * agir au nom d'un utilisateur réel.
 */

export type Id = mongoose.Types.ObjectId;

/** Délai pendant lequel une alerte déjà LUE n'est pas répétée. */
const REPEAT_AFTER_MS = 7 * 86_400_000;
const liveCache = new Map<string, { live: boolean; at: number }>();

/** Organisation active (abonnement en cours) — mémorisé une minute. */
async function tenantLive(tenantId: Id): Promise<boolean> {
  const k = String(tenantId), hit = liveCache.get(k);
  if (hit && Date.now() - hit.at < 60_000) return hit.live;
  const t = await TenantModel.findById(tenantId).select("subscriptionStatus").lean<{ subscriptionStatus?: string } | null>();
  const live = !!t && ["active", "trial"].includes(t.subscriptionStatus ?? "");
  liveCache.set(k, { live, at: Date.now() });
  return live;
}

/**
 * Notification d'une tâche planifiée, dédoublonnée : la même alerte (même
 * type, même pièce, même texte) n'est pas recréée tant que la précédente
 * n'est pas lue, ni dans les 7 jours qui suivent sa lecture — une facture en
 * retard notifiait chaque matin. Rien pour une organisation suspendue.
 * Renvoie vrai si la notification a été créée.
 */
export async function notify(
  tenantId: Id, userId: Id, type: string, title: string, message: string,
  linkedTo?: string, linkedId?: Id
): Promise<boolean> {
  try {
    if (!(await tenantLive(tenantId))) return false;
    const same = { tenantId, userId, type, ...(linkedId ? { linkedId } : { message }) };
    const dup = await NotificationModel.exists({ ...same, $or: [{ read: false }, { createdAt: { $gte: new Date(Date.now() - REPEAT_AFTER_MS) } }] });
    if (dup) return false;
    await NotificationModel.create({ tenantId, userId, type, title, message, linkedTo, linkedId });
    return true;
  } catch (err) {
    console.error("[Cron] notification non créée:", err);
    return false;
  }
}

/** Purge : notifications lues de plus de 90 jours, toutes celles de plus d'un an. */
export async function purgeNotifications(now = new Date()) {
  const r = await NotificationModel.deleteMany({ $or: [
    { read: true, createdAt: { $lt: new Date(now.getTime() - 90 * 86_400_000) } },
    { createdAt: { $lt: new Date(now.getTime() - 365 * 86_400_000) } },
  ] });
  return r.deletedCount ?? 0;
}

export async function getAdmins(tenantId: Id, roles: string[]): Promise<Array<{ _id: Id }>> {
  // Rôle principal OU rôle cumulé : un comptable qui est aussi chef de service
  // doit recevoir les alertes de ses deux casquettes.
  return UserModel.find({ tenantId, isActive: true, $or: [{ role: { $in: roles } }, { roles: { $in: roles } }] })
    .select("_id").lean<Array<{ _id: Id }>>();
}

/** Utilisateurs actifs d'un rôle, avec de quoi leur écrire. */
export async function getRecipients(tenantId: Id, roles: string[]) {
  return UserModel.find({ tenantId, isActive: true, $or: [{ role: { $in: roles } }, { roles: { $in: roles } }] })
    .select("_id email firstName lastName phone").lean<Array<{ _id: Id; email?: string; firstName?: string; lastName?: string; phone?: string }>>();
}

export interface ActingUser {
  auth: Omit<TokenPayload, "iat" | "exp">;
  user: { _id: Id; email: string; firstName?: string; lastName?: string; phone?: string };
}

/**
 * Jeton de session reconstruit pour un utilisateur : une tâche automatique qui
 * passe une écriture ou lit un brief le fait avec SES droits, exactement comme
 * s'il était connecté — ni plus (pas de super-compte système), ni moins.
 */
export async function actAs(userId: Id): Promise<ActingUser | null> {
  const user = await UserModel.findOne({ _id: userId, isActive: true })
    .select("_id tenantId role roles email firstName lastName phone allowedResources roleLevels siteIds sessionVersion")
    .lean<{ _id: Id; tenantId: Id; role: string; roles?: string[]; email: string; firstName?: string; lastName?: string; phone?: string; allowedResources?: string[]; roleLevels?: Record<string, string>; siteIds?: Id[]; sessionVersion?: number } | null>();
  if (!user) return null;
  const tenant = await TenantModel.findById(user.tenantId).select("type subscriptionStatus planModules")
    .lean<{ type: string; subscriptionStatus: string; planModules?: string[] } | null>();
  if (!tenant) return null;
  return {
    auth: buildSessionPayload(user, { type: tenant.type, subscriptionStatus: tenant.subscriptionStatus, planModules: tenant.planModules ?? [] }),
    user: { _id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone },
  };
}

/** Premier utilisateur actif d'un des rôles, dans l'ordre donné (le gérant avant le comptable…). */
export async function firstActorOf(tenantId: Id, roles: string[]): Promise<ActingUser | null> {
  for (const role of roles) {
    const u = await UserModel.findOne({ tenantId, isActive: true, $or: [{ role }, { roles: role }] }).sort({ createdAt: 1 }).select("_id").lean<{ _id: Id } | null>();
    if (u) return actAs(u._id);
  }
  return null;
}

/** Organisations dont l'abonnement est en cours (les tâches ignorent les autres). */
export async function liveTenants(filter: Record<string, unknown> = {}) {
  return TenantModel.find({ subscriptionStatus: { $in: ["active", "trial"] }, ...filter })
    .select("_id name type").lean<Array<{ _id: Id; name: string; type: "pme" | "association" | "administration" }>>();
}
