import { Types } from "mongoose";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { isServiceRole, ROLE_LEVELS, type RoleLevel } from "@/lib/role-resources";

export interface AccessInput {
  roleLevels?: unknown;
  siteIds?: unknown;
  accessUntil?: unknown;
}
export interface AccessValue {
  roleLevels: Record<string, RoleLevel> | undefined;
  siteIds: Types.ObjectId[] | undefined;
  accessUntil: Date | null;
}

/**
 * Valide l'accès d'un collaborateur pour la liste de rôles donnée :
 *  - un niveau par rôle de SERVICE (défaut : employé) — ignoré pour les autres ;
 *  - un stagiaire a obligatoirement une date de fin d'accès, dans le futur ;
 *  - un employé ou stagiaire de The Spot a au moins un site, qui doit
 *    appartenir à l'organisation (le chef voit tous les sites) ;
 *  - rien d'autre n'est accepté depuis le corps de la requête.
 */
export async function parseAccess(
  input: AccessInput,
  roles: string[],
  tenantId: string,
  current?: { roleLevels?: Record<string, string>; siteIds?: unknown[]; accessUntil?: Date | null },
): Promise<{ ok: true; value: AccessValue } | { ok: false; error: string }> {
  const raw = (input.roleLevels ?? current?.roleLevels ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Niveaux invalides." };

  const roleLevels: Record<string, RoleLevel> = {};
  for (const r of roles.filter(isServiceRole)) {
    const lvl = raw[r] ?? "employe";
    if (!ROLE_LEVELS.includes(lvl as RoleLevel)) return { ok: false, error: `Niveau inconnu pour ${r} : ${String(lvl)}` };
    roleLevels[r] = lvl as RoleLevel;
  }

  // Fin d'accès
  let accessUntil: Date | null = null;
  const rawUntil = "accessUntil" in input ? input.accessUntil : current?.accessUntil;
  if (rawUntil) {
    const d = new Date(String(rawUntil instanceof Date ? rawUntil.toISOString() : rawUntil));
    if (isNaN(d.getTime())) return { ok: false, error: "Date de fin d'accès invalide." };
    accessUntil = d;
  }
  const hasIntern = Object.values(roleLevels).includes("stagiaire");
  if (hasIntern) {
    if (!accessUntil) return { ok: false, error: "Indiquez la date de fin de stage : l'accès d'un stagiaire se ferme automatiquement à cette date." };
    if ("accessUntil" in input && accessUntil.getTime() < Date.now()) return { ok: false, error: "La date de fin de stage est déjà passée." };
  }

  // Sites The Spot
  let siteIds: Types.ObjectId[] | undefined;
  const needsSites = roles.includes("svc_spot") && roleLevels.svc_spot !== "chef";
  if (needsSites) {
    const rawSites = (input.siteIds ?? current?.siteIds ?? []) as unknown[];
    if (!Array.isArray(rawSites)) return { ok: false, error: "Sites invalides." };
    const ids = [...new Set(rawSites.map(String))];
    if (!ids.length) return { ok: false, error: "Attribuez au moins un site The Spot à ce collaborateur." };
    if (ids.some(id => !Types.ObjectId.isValid(id))) return { ok: false, error: "Site The Spot invalide." };
    const found = await ActivityDeskModel.countDocuments({ _id: { $in: ids }, tenantId });
    if (found !== ids.length) return { ok: false, error: "Un des sites The Spot n'existe pas dans votre organisation." };
    siteIds = ids.map(id => new Types.ObjectId(id));
  }

  return { ok: true, value: { roleLevels: Object.keys(roleLevels).length ? roleLevels : undefined, siteIds, accessUntil } };
}
