import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, forbidden, notFound, tenantFilter } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { hashPassword, generateSecureToken, TokenPayload } from "@/lib/auth";
import crypto from "crypto";
import { sendEmail, templatePasswordReset } from "@/lib/email";
import { appBaseUrl } from "@/lib/app-url";
import { temporaryPassword } from "@/lib/password-policy";
import { logAudit } from "@/lib/audit";
import { hasTenantAdminRole } from "@/lib/roles-ui";

export const dynamic = "force-dynamic";


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
export const POST = withAuth("users", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  // Options : `mode` « temporary » (mot de passe à dicter, défaut) ou « link »
  // (lien de réinitialisation envoyé par courriel et renvoyé à l'administrateur
  // pour WhatsApp) ; `resetTwoFactor` pour un téléphone perdu.
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === "link" ? "link" : "temporary";
  const resetTwoFactor = body.resetTwoFactor === true;
  if (!hasTenantAdminRole(auth)) {
    return forbidden("Seuls les administrateurs peuvent réinitialiser un mot de passe.");
  }
  if (auth.userId === String(params.id)) {
    return badRequest(
      "Pour votre propre compte, passez par « Changer mon mot de passe » : "
      + "cela exige l'ancien, et vous évite d'être déconnecté."
    );
  }

  const user = await UserModel.findOne({ _id: params.id, ...tenantFilter(auth), deletedAt: { $exists: false } })
    .select("email firstName lastName role roles sessionVersion twoFactorEnabled isActive");
  if (!user) return notFound("Utilisateur introuvable");

  // Un administrateur d'organisation ne réinitialise pas un superadmin : ce
  // serait une élévation de privilège par la porte de service.
  if (user.role === "superadmin" && auth.role !== "superadmin") {
    return forbidden("Compte hors de votre périmètre.");
  }

  if (user.isActive === false) return badRequest("Compte désactivé : réactivez-le avant de le réinitialiser.");
  // Double authentification : remise à zéro (téléphone perdu, application supprimée).
  if (resetTwoFactor) {
    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    user.twoFactorPending = undefined;
    user.twoFactorBackupCodes = undefined;
  }
  // Toutes les sessions tombent : si le compte était compromis, le laisser
  // ouvert rendrait la réinitialisation décorative.
  user.sessionVersion = (user.sessionVersion ?? 1) + 1;

  if (mode === "link") {
    const token = generateSecureToken();
    user.passwordResetToken = crypto.createHash("sha256").update(token).digest("hex");
    user.passwordResetExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h
    await user.save();
    const link = `${appBaseUrl()}/reinitialiser?token=${token}`;
    const sent = await sendEmail({ ...templatePasswordReset(link), to: user.email });
    await logAudit(auth, "UPDATE", "users", {
      resourceId: String(params.id),
      metadata: { action: "password_reset_link_by_admin", target: user.email, emailed: sent.sent, twoFactorReset: resetTwoFactor },
    });
    return ok({
      link, emailed: sent.sent, email: user.email,
      message: sent.sent
        ? `Lien de réinitialisation envoyé à ${user.email} (valable 24 h). Vous pouvez aussi le lui transmettre directement.`
        : `Le courriel n'a pas pu partir : transmettez ce lien à ${user.firstName} (valable 24 h).`,
    });
  }

  const temporary = temporaryPassword();
  user.passwordHash = await hashPassword(temporary);
  user.mustChangePassword = true;
  user.passwordChangedAt = new Date();
  user.passwordResetToken = undefined;
  user.passwordResetExpiry = undefined;
  await user.save();

  await logAudit(auth, "UPDATE", "users", {
    resourceId: String(params.id),
    metadata: { action: "password_reset_by_admin", target: user.email, sessionsRevoked: true, twoFactorReset: resetTwoFactor },
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
