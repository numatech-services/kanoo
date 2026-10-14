import { Types } from "mongoose";
import { tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { canPerformAction, effectiveRoles } from "@/lib/role-resources";
import { UserRole } from "@/types";

import { postCashFlow } from "@/lib/cash-posting";
import type { ClientSession } from "mongoose";
export const isId = (v: unknown): v is string =>
  typeof v === "string" && Types.ObjectId.isValid(v);

/**
 * Sites (comptoirs) accessibles : `null` = tous. Un employé ou stagiaire du
 * service The Spot ne voit que les sites qui lui sont attribués ; le chef The
 * Spot, la comptabilité et le gérant voient tous les sites.
 */
export function deskScope(auth: TokenPayload): string[] | null {
  const roles = effectiveRoles(auth.role, auth.roles);
  const levels = auth.roleLevels ?? {};
  for (const r of roles) {
    if (r === "svc_spot") { if (levels.svc_spot === "chef") return null; continue; }
    if (canPerformAction(r as UserRole, "comptoir", "read", auth.allowedResources, levels[r])) return null;
  }
  return auth.siteIds ?? [];
}

/** Vrai si l'appelant peut agir sur tous les sites (créer / paramétrer un comptoir). */
export function allDesks(auth: TokenPayload): boolean {
  return deskScope(auth) === null;
}

/**
 * Le comptoir demandé, s'il existe, appartient à l'organisation de l'appelant
 * ET fait partie de ses sites. Toute lecture ou écriture d'un comptoir passe par
 * ce contrôle : un site non attribué répond « introuvable ».
 */
export async function ownDesk(auth: TokenPayload, deskId: unknown) {
  if (!isId(deskId)) return null;
  const scope = deskScope(auth);
  if (scope && !scope.includes(String(deskId))) return null;
  return ActivityDeskModel.findOne({ _id: deskId, ...tenantFilter(auth) })
    .select("_id name activityId").lean<{ _id: Types.ObjectId; name: string; activityId?: Types.ObjectId } | null>();
}

/** Filtre Mongo « sites accessibles » pour les collections rattachées à un comptoir. */
export function deskFilter(auth: TokenPayload): Record<string, unknown> {
  const scope = deskScope(auth);
  return scope ? { deskId: { $in: scope.filter(isId).map(id => new Types.ObjectId(id)) } } : {};
}

/**
 * Comptabilise une écriture de caisse de comptoir, si le comptoir est relié à
 * une caisse de trésorerie (lib/cash-posting). Sans liaison, rien n'est écrit :
 * le comptoir affiche alors un avertissement « caisse hors comptabilité ».
 */
export async function postDeskCash(
  auth: TokenPayload,
  deskId: unknown,
  entry: { _id: unknown; direction: "in" | "out"; amount: number; date: Date; label: string; entryId?: unknown; movementId?: unknown; save: (o?: { session?: ClientSession }) => Promise<unknown> },
  session?: ClientSession,
) {
  const desk = await ActivityDeskModel.findOne({ _id: deskId, ...tenantFilter(auth) }).session(session ?? null)
    .select("name activityId treasuryAccountId revenueAccount expenseAccount vatRate")
    .lean<{ name: string; activityId?: unknown; treasuryAccountId?: unknown; revenueAccount?: string; expenseAccount?: string; vatRate?: number } | null>();
  if (!desk?.treasuryAccountId) return null;
  const isIn = entry.direction === "in";
  const posted = await postCashFlow({
    tenantId: auth.tenantId, userId: auth.userId, treasuryAccountId: desk.treasuryAccountId,
    direction: entry.direction, amount: entry.amount, date: entry.date,
    label: `${desk.name} — ${entry.label}`, reference: `CPT-${String(entry._id).slice(-6).toUpperCase()}`,
    account: isIn
      ? { accountCode: desk.revenueAccount || "701100", accountLabel: "Ventes du comptoir" }
      : { accountCode: desk.expenseAccount || "601100", accountLabel: "Dépenses du comptoir" },
    vatRate: desk.vatRate ?? 0, activityId: desk.activityId,
    linkedDocType: "desk_cash", linkedDocId: entry._id,
  }, session);
  entry.entryId = posted.entryId;
  entry.movementId = posted.movementId;
  await entry.save({ session });
  return posted;
}
