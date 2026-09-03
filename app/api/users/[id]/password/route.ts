import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, forbidden, notFound, tenantFilter } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { hashPassword, TokenPayload } from "@/lib/auth";
import { temporaryPassword } from "@/lib/password-policy";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const TENANT_ADMIN_ROLES = ["pme_admin", "asso_president", "admin_ordonnateur", "superadmin"];

/**
 * POST /api/users/:id/password — réinitialisation par un administrateur.
 *
 * Le cas réel : quelqu'un a oublié son mot de passe, et il n'existait aucun
 * moyen de le lui rendre. L'administrateur génère ici un mot de passe
 * temporaire, dictable au téléphone, qu'il transmet de vive voix.
 *
 * Deux garde-fous qui font toute la différence :
 *
 * 1. **L'administrateur ne choisit pas le mot de passe.** Il est engendré. Un
 *    administrateur qui saisit lui-même une valeur en met une qu'il connaît,
 *    la réutilise pour dix comptes, et laisse une porte ouverte durablement.
 * 2. **`mustChangePassword` est posé.** Le mot de passe temporaire est connu
 *    de deux personnes ; il ne survit pas à la première connexion.
 *
 * Le mot de passe n'est renvoyé qu'**une seule fois**, dans cette réponse : il
 * n'est stocké nulle part en clair et ne se retrouve pas.
 */
export const POST = withAuth("users", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  if (!TENANT_ADMIN_ROLES.includes(auth.role)) {
    return forbidden("Seuls les administrateurs peuvent réinitialiser un mot de passe.");
  }
  if (auth.userId === String(params.id)) {
    return badRequest(
      "Pour votre propre compte, passez par « Changer mon mot de passe » : "
      + "cela exige l'ancien, et vous évite d'être déconnecté."
    );
  }

  const user = await UserModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("email firstName lastName role sessionVersion");
  if (!user) return notFound("Utilisateur introuvable");

  // Un administrateur d'organisation ne réinitialise pas un superadmin : ce
  // serait une élévation de privilège par la porte de service.
  if (user.role === "superadmin" && auth.role !== "superadmin") {
    return forbidden("Compte hors de votre périmètre.");
  }

  const temporary = temporaryPassword();
  user.passwordHash = await hashPassword(temporary);
  user.mustChangePassword = true;
  user.passwordChangedAt = new Date();
  // Toutes les sessions tombent : si le compte était compromis, le laisser
  // ouvert rendrait la réinitialisation décorative.
  user.sessionVersion = (user.sessionVersion ?? 1) + 1;
  user.passwordResetToken = undefined;
  user.passwordResetExpiry = undefined;
  await user.save();

  await logAudit(auth, "UPDATE", "users", {
    resourceId: String(params.id),
    metadata: { action: "password_reset_by_admin", target: user.email, sessionsRevoked: true },
  });

  return ok({
    temporaryPassword: temporary,
    email: user.email,
    message:
      `Mot de passe temporaire pour ${user.firstName} ${user.lastName}. `
      + `Transmettez-le de vive voix : il ne sera plus affiché, et devra être `
      + `remplacé à la première connexion.`,
  });
});
