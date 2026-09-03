import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { comparePassword, signTwoFactorChallenge } from "@/lib/auth";
import { buildSessionPayload, setSessionCookies } from "@/lib/session";
import { badRequest, serverError, unauthorized } from "@/lib/api-helpers";
import { rateLimit, resetRateLimit, clientIp } from "@/lib/rate-limit";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { logAudit } from "@/lib/audit";

// Deux limites complémentaires : par adresse (bruteforce distribué sur un
// compte) et par compte (bruteforce distribué sur plusieurs adresses). Un
// bureau derrière une seule IP publique n'est pas bloqué par la première tant
// que ses utilisateurs se connectent correctement.
const IP_MAX = 20;
const IP_WINDOW_MS = 60_000;
const ACCOUNT_MAX = 5;
const ACCOUNT_WINDOW_MS = 15 * 60_000;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  const byIp = rateLimit("login:ip", ip, IP_MAX, IP_WINDOW_MS);
  if (!byIp.allowed) {
    return NextResponse.json(
      { success: false, error: `Trop de tentatives. Réessayez dans ${byIp.retryAfter} secondes.` },
      { status: 429, headers: { "Retry-After": String(byIp.retryAfter) } }
    );
  }

  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return badRequest("Email et mot de passe requis");
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const byAccount = rateLimit("login:account", normalizedEmail, ACCOUNT_MAX, ACCOUNT_WINDOW_MS);
    if (!byAccount.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Compte temporairement verrouillé après plusieurs échecs. Réessayez dans ${Math.ceil(byAccount.retryAfter / 60)} minutes.`,
        },
        { status: 429, headers: { "Retry-After": String(byAccount.retryAfter) } }
      );
    }

    await connectDB();

    const user = await UserModel.findOne({ email: normalizedEmail, isActive: true });
    if (!user) return unauthorized("Identifiants incorrects");

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      await logAudit(
        {
          userId: user._id.toString(), tenantId: user.tenantId.toString(), email: user.email,
          role: user.role, tenantType: "pme", subscriptionStatus: "active", planModules: [],
        },
        "LOGIN_FAILED", "auth", { ip }
      );
      return unauthorized("Identifiants incorrects");
    }

    const tenant = await TenantModel.findById(user.tenantId);
    if (!tenant) return unauthorized("Organisation introuvable");

    // Vérification abonnement (sauf superadmin)
    if (user.role !== "superadmin") {
      if (tenant.subscriptionStatus === "suspended" || tenant.subscriptionStatus === "cancelled") {
        return NextResponse.json(
          { success: false, error: "Abonnement inactif. Contactez le support." },
          { status: 402 }
        );
      }
    }

    // Mot de passe validé : le compte n'est plus suspect, on rend son quota.
    resetRateLimit("login:account", normalizedEmail);

    // 2FA activé : ne pas ouvrir la session — exiger d'abord le code TOTP.
    if (user.twoFactorEnabled) {
      const challenge = signTwoFactorChallenge(user._id.toString());
      const res2 = NextResponse.json({ success: true, data: { twoFactorRequired: true } });
      res2.cookies.set("twofa_token", challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 5 * 60,
        path: "/",
      });
      return res2;
    }

    user.lastLoginAt = new Date();
    await user.save();

    const tokenPayload = buildSessionPayload(user, tenant);

    await logAudit(tokenPayload, "LOGIN", "auth", { ip });

    const response = NextResponse.json({
      success: true,
      data: {
        user: { id: user._id, email: user.email, role: user.role },
        tenantType: tenant.type,
        role: user.role,
        // Mot de passe temporaire attribué par un administrateur : l'écran
        // redirige vers le changement. Le signaler ici plutôt que de laisser
        // un mot de passe connu de deux personnes vivre des mois.
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    });
    setSessionCookies(response, tokenPayload);
    return response;
  } catch (err) {
    return serverError(err);
  }
}
