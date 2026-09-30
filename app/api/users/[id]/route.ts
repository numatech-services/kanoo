import { NextRequest } from "next/server";
import { withAuth, ok, notFound, forbidden, conflict, tenantFilter, badRequest } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { assignableRoles } from "@/lib/roles-ui";
import { parseAccess } from "@/lib/user-access";

export const GET = withAuth("users", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const filter = auth.role === "superadmin" ? { _id: params.id } : { _id: params.id, ...tenantFilter(auth) };
  const user = await UserModel.findOne(filter).select("-passwordHash").lean();
  if (!user) return notFound(); return ok(user);
});
// Champs modifiables par l'utilisateur sur son propre profil.
const SELF_EDITABLE = ["firstName", "lastName", "phone", "avatar"] as const;
// Champs réservés aux administrateurs (sur les comptes de leur organisation).
const ADMIN_EDITABLE = ["role", "roles", "allowedResources", "isActive", "roleLevels", "siteIds", "accessUntil"] as const;
const TENANT_ADMIN_ROLES = ["pme_admin", "asso_president", "admin_ordonnateur", "superadmin"];

export const PATCH = withAuth("users", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const isSelf = auth.userId === params.id;
  const isAdmin = TENANT_ADMIN_ROLES.includes(auth.role);
  if (!isSelf && !isAdmin) {
    return forbidden("Vous ne pouvez modifier que votre propre profil");
  }

  const body = await req.json();

  // Liste blanche stricte : jamais tenantId / passwordHash / sessionVersion /
  // email / _id depuis le corps (sinon élévation de privilèges ou cross-tenant).
  const update: Record<string, unknown> = {};
  for (const k of SELF_EDITABLE) if (k in body) update[k] = body[k];
  if (isAdmin) {
    for (const k of ADMIN_EDITABLE) if (k in body) update[k] = body[k];

    // Multi-rôle : si `roles` est fourni, il fait foi ; `role` en devient le
    // premier. Si seul `role` est fourni, on aligne `roles` dessus pour que les
    // deux champs restent cohérents en base.
    if ("roles" in update) {
      const list = Array.isArray(update.roles) ? [...new Set((update.roles as unknown[]).map(x => String(x)))] : [];
      if (list.length === 0) return badRequest("Au moins un rôle est requis.");
      if (list.length > 5) return badRequest("Cinq rôles au maximum par collaborateur.");
      update.roles = list;
      update.role = list[0];
    } else if ("role" in update) {
      update.roles = [String(update.role)];
    }

    // Seul un superadmin peut octroyer le rôle superadmin — dans role OU roles.
    const targetsSuperadmin = update.role === "superadmin"
      || (Array.isArray(update.roles) && update.roles.includes("superadmin"));
    if (targetsSuperadmin && auth.role !== "superadmin") {
      return forbidden("Attribution du rôle superadmin non autorisée");
    }

    // Accès actuel du compte : un ancien rôle déjà porté peut être conservé
    // (pas réattribué ailleurs) ; niveaux, sites et fin d'accès sont revalidés.
    const touchesAccess = ["roles", "role", "roleLevels", "siteIds", "accessUntil"].some(k => k in update);
    if (touchesAccess) {
      const target = await UserModel.findOne(auth.role === "superadmin" ? { _id: params.id } : { _id: params.id, ...tenantFilter(auth) })
        .select("role roles roleLevels siteIds accessUntil tenantId")
        .lean<{ role: string; roles?: string[]; roleLevels?: Record<string, string>; siteIds?: unknown[]; accessUntil?: Date; tenantId: unknown } | null>();
      if (!target) return notFound();
      const currentRoles = target.roles?.length ? target.roles : [target.role];

      // Même liste blanche qu'à la création : on ne peut attribuer que les rôles
      // de son type d'organisation (pas de rôle « administration » dans une PME).
      if (Array.isArray(update.roles)) {
        const allowed = [...assignableRoles(auth), ...currentRoles];
        const refused = (update.roles as string[]).find(r => !allowed.includes(r));
        if (refused) return badRequest(`Rôle non autorisé pour ce type d'organisation : ${refused}`);
      }
      const nextRoles = (update.roles as string[] | undefined) ?? currentRoles;
      const access = await parseAccess(update, nextRoles, String(target.tenantId), target);
      if (!access.ok) return badRequest(access.error);
      update.roleLevels = access.value.roleLevels;
      update.siteIds = access.value.siteIds;
      update.accessUntil = access.value.accessUntil;
    }
  }

  // ── Garde anti-verrouillage ─────────────────────────────────────────────
  //
  // Rien n'empêchait un administrateur de se rétrograder lui-même, ni de
  // désactiver le dernier compte capable d'administrer l'organisation. Le
  // résultat est irrattrapable depuis l'application : plus personne ne peut
  // créer d'utilisateur, changer un rôle, ni réactiver quoi que ce soit. Il
  // faut alors une intervention en base.
  const newRoles: string[] = Array.isArray(update.roles)
    ? update.roles.map(String)
    : "role" in update ? [String(update.role)] : [];
  const losesAdmin =
    (newRoles.length > 0 && !newRoles.some(r => TENANT_ADMIN_ROLES.includes(r)))
    || ("isActive" in update && update.isActive === false);

  if (losesAdmin) {
    const target = await UserModel.findOne({ _id: params.id, ...tenantFilter(auth) })
      .select("role isActive").lean<{ role?: string; isActive?: boolean } | null>();
    if (!target) return notFound();

    const wasAdmin = TENANT_ADMIN_ROLES.includes(String(target.role)) && target.isActive !== false;
    if (wasAdmin) {
      const remaining = await UserModel.countDocuments({
        ...tenantFilter(auth),
        _id: { $ne: params.id },
        isActive: true,
        role: { $in: TENANT_ADMIN_ROLES },
      });
      if (remaining === 0) {
        return conflict(
          "C'est le dernier compte administrateur actif de l'organisation. "
          + "Désignez d'abord un autre administrateur : sans lui, plus personne "
          + "ne pourrait créer de compte ni modifier un rôle."
        );
      }
    }
  }

  // On ne se retire pas soi-même ses propres droits d'administration : le
  // geste est presque toujours une erreur de ligne dans un tableau.
  if (isSelf && losesAdmin && TENANT_ADMIN_ROLES.includes(auth.role)) {
    return conflict(
      "Vous ne pouvez pas retirer vos propres droits d'administration. "
      + "Demandez à un autre administrateur de le faire."
    );
  }

  // Un niveau, un site ou une date retirés doivent disparaître de la base :
  // une valeur vide passe en $unset plutôt que de laisser l'ancienne en place.
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(update)) {
    if (v === undefined || v === null) $unset[k] = 1; else $set[k] = v;
  }
  const user = await UserModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) },
    { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
    { new: true }
  ).select("-passwordHash");
  if (!user) return notFound();

  // Un changement de rôle ou une désactivation prend effet immédiatement —
  // `withAuth` relit la base à chaque requête. La révocation explicite ferme
  // en plus les sessions ouvertes, pour que l'intéressé le constate.
  if (losesAdmin || "role" in update || "roles" in update || "roleLevels" in update || "siteIds" in update) {
    await UserModel.updateOne({ _id: params.id }, { $inc: { sessionVersion: 1 } });
  }
  await logAudit(auth, "UPDATE", "users", { resourceId: params.id });
  return ok(user);
});
