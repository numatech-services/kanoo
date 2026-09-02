import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { comparePassword, signTwoFactorChallenge } from "@/lib/auth";
import { setSessionCookies } from "@/lib/session";
import { badRequest, serverError, unauthorized } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { logAudit } from "@/lib/audit";

// Rate limiting simple en mémoire
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Trop de tentatives. Réessayez dans 60 secondes." },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return badRequest("Email et mot de passe requis");
    }

    await connectDB();

    const user = await UserModel.findOne({ email: email.toLowerCase().trim(), isActive: true });
    if (!user) return unauthorized("Identifiants incorrects");

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      // Audit simplifié pour le fail
      await logAudit(
        { userId: user._id.toString(), tenantId: user.tenantId.toString(), email: user.email, role: user.role, tenantType: "pme", subscriptionStatus: "active", planModules: [] },
        "LOGIN_FAILED", "auth", { ip }
      );
      return unauthorized("Identifiants incorrects");
    }

    const tenant = await TenantModel.findById(user.tenantId);
    if (!tenant) return unauthorized("Organisation introuvable");

    // Vérification abonnement (sauf superadmin)
    if (user.role !== "superadmin") {
      if (tenant.subscriptionStatus === "suspended" || tenant.subscriptionStatus === "cancelled") {
        return NextResponse.json({ error: "Abonnement inactif. Contactez le support." }, { status: 402 });
      }
    }

    user.lastLoginAt = new Date();
    await user.save();

    const tokenPayload = {
      userId: user._id.toString(),
      tenantId: user.tenantId.toString(),
      tenantType: tenant.type,
      role: user.role,
      email: user.email,
      subscriptionStatus: tenant.subscriptionStatus,
      planModules: tenant.planModules,
      allowedResources: user.allowedResources,
    };

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

    await logAudit(tokenPayload, "LOGIN", "auth", { ip });

    const response = NextResponse.json({
      success: true,
      data: {
        user: { id: user._id, email: user.email, role: user.role },
        tenantType: tenant.type,
        role: user.role,
      },
    });
    setSessionCookies(response, tokenPayload);
    return response;
  } catch (err) {
    return serverError(err);
  }
}