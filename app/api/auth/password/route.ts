import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { hashPassword, comparePassword, signToken, TokenPayload } from "@/lib/auth";
import { passwordErrors } from "@/lib/password-policy";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/password — changer son propre mot de passe.
 *
 * Aucune route ne permettait cela jusqu'ici : `passwordResetToken` était un
 * champ mort, `templatePasswordReset` un modèle d'e-mail que rien n'appelait.
 * Un mot de passe attribué à la création était donc définitif — et un mot de
 * passe qu'on ne peut pas changer est un mot de passe qu'on ne change pas
 * quand il fuit.
 *
 * Trois points de conception :
 *
 * 1. **Le mot de passe actuel est exigé**, même sur une session valide. Un
 *    poste laissé déverrouillé deux minutes ne doit pas suffire à verrouiller
 *    son propriétaire dehors.
 * 2. **Les autres sessions sont révoquées.** Changer son mot de passe est
 *    précisément ce qu'on fait quand on le croit compromis : laisser les
 *    sessions ouvertes viderait le geste de son sens. La session courante est
 *    réémise pour ne pas éjecter celui qui vient d'agir.
 * 3. Le nouveau mot de passe passe la politique — et ne peut pas être
 *    l'ancien.
 */
export const POST = withAuth("notifications", "read", async (req: NextRequest, auth: TokenPayload) => {
  // Cinq tentatives par quart d'heure : assez pour une faute de frappe,
  // trop peu pour éprouver un mot de passe actuel au hasard.
  const limit = rateLimit("password-change", auth.userId, 5, 15 * 60_000);
  if (!limit.allowed) {
    return forbidden(`Trop de tentatives. Réessayez dans ${Math.ceil(limit.retryAfter / 60)} minutes.`);
  }

  const body = await req.json().catch(() => ({}));
  const current = String(body.currentPassword || "");
  const next = String(body.newPassword || "");

  if (!current || !next) return badRequest("Mot de passe actuel et nouveau mot de passe attendus.");

  const user = await UserModel.findById(auth.userId)
    .select("passwordHash email firstName lastName sessionVersion tenantId role");
  if (!user) return forbidden("Compte introuvable.");

  if (!(await comparePassword(current, user.passwordHash))) {
    await logAudit(auth, "UPDATE", "users", {
      resourceId: auth.userId,
      metadata: { action: "password_change", outcome: "wrong_current_password" },
    });
    return badRequest("Le mot de passe actuel ne correspond pas.");
  }

  if (current === next) {
    return badRequest("Le nouveau mot de passe est identique à l'ancien.");
  }

  const tenant = await TenantModel.findById(user.tenantId).select("name")
    .lean<{ name?: string } | null>();

  const problems = passwordErrors(next, {
    email: user.email, firstName: user.firstName, lastName: user.lastName,
    tenantName: tenant?.name,
  });
  if (problems.length > 0) return badRequest(problems.join(" "));

  user.passwordHash = await hashPassword(next);
  user.sessionVersion = (user.sessionVersion ?? 1) + 1;
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date();
  user.passwordResetToken = undefined;
  user.passwordResetExpiry = undefined;
  await user.save();

  await logAudit(auth, "UPDATE", "users", {
    resourceId: auth.userId,
    metadata: { action: "password_change", outcome: "ok", sessionsRevoked: true },
  });

  // Le jeton courant vient d'être invalidé par l'incrément : on en réémet un
  // à la nouvelle version, faute de quoi l'utilisateur serait déconnecté par
  // son propre changement de mot de passe.
  const token = signToken({
    userId: auth.userId,
    tenantId: auth.tenantId,
    tenantType: auth.tenantType,
    role: auth.role,
    email: auth.email,
    subscriptionStatus: auth.subscriptionStatus,
    planModules: auth.planModules,
    allowedResources: auth.allowedResources,
    sessionVersion: user.sessionVersion,
  });

  const response = ok({
    changed: true,
    message: "Mot de passe modifié. Vos autres sessions ont été déconnectées.",
  });
  response.cookies.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  return response;
});
