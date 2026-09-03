import { NextRequest } from "next/server";
import { withAuth, ok, notFound, forbidden, conflict, tenantFilter } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("users", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const filter = auth.role === "superadmin" ? { _id: params.id } : { _id: params.id, ...tenantFilter(auth) };
  const user = await UserModel.findOne(filter).select("-passwordHash").lean();
  if (!user) return notFound(); return ok(user);
});
// Champs modifiables par l'utilisateur sur son propre profil.
const SELF_EDITABLE = ["firstName", "lastName", "phone", "avatar"] as const;
// Champs réservés aux administrateurs (sur les comptes de leur organisation).
const ADMIN_EDITABLE = ["role", "allowedResources", "isActive"] as const;
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
    // Seul un superadmin peut octroyer le rôle superadmin.
    if (update.role === "superadmin" && auth.role !== "superadmin") {
      return forbidden("Attribution du rôle superadmin non autorisée");
    }
  }

  // ── Garde anti-verrouillage ─────────────────────────────────────────────
  //
  // Rien n'empêchait un administrateur de se rétrograder lui-même, ni de
  // désactiver le dernier compte capable d'administrer l'organisation. Le
  // résultat est irrattrapable depuis l'application : plus personne ne peut
  // créer d'utilisateur, changer un rôle, ni réactiver quoi que ce soit. Il
  // faut alors une intervention en base.
  const losesAdmin =
    ("role" in update && !TENANT_ADMIN_ROLES.includes(String(update.role)))
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

  const user = await UserModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) },
    { $set: update },
    { new: true }
  ).select("-passwordHash");
  if (!user) return notFound();

  // Un changement de rôle ou une désactivation prend effet immédiatement —
  // `withAuth` relit la base à chaque requête. La révocation explicite ferme
  // en plus les sessions ouvertes, pour que l'intéressé le constate.
  if (losesAdmin || "role" in update) {
    await UserModel.updateOne({ _id: params.id }, { $inc: { sessionVersion: 1 } });
  }
  await logAudit(auth, "UPDATE", "users", { resourceId: params.id });
  return ok(user);
});
