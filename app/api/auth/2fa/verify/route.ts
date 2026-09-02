import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { badRequest, unauthorized } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { verifyTwoFactorChallenge, comparePassword } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { decryptField } from "@/lib/crypto-field";
import { buildSessionPayload, setSessionCookies } from "@/lib/session";
import { rateLimit, resetRateLimit, clientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

// Un code TOTP fait six chiffres et le défi vit cinq minutes : sans plafond,
// la fenêtre suffit largement à parcourir l'espace. Dix essais par défi.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60_000;

// Étape 2 de la connexion : valide le code TOTP (ou un code de secours) puis ouvre la session.
export async function POST(req: NextRequest) {
  const challenge = req.cookies.get("twofa_token")?.value;
  const parsed = challenge ? verifyTwoFactorChallenge(challenge) : null;
  if (!parsed) return unauthorized("Session 2FA expirée. Reconnectez-vous.");

  // Le quota est porté par l'utilisateur visé, pas par l'adresse : le défi
  // désigne déjà un compte précis.
  const attempt = rateLimit("2fa:verify", parsed.uid, MAX_ATTEMPTS, WINDOW_MS);
  if (!attempt.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de codes erronés. Reconnectez-vous." },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfter) } }
    );
  }

  const { token } = await req.json();
  const code = String(token || "").trim();

  await connectDB();
  const user = await UserModel.findById(parsed.uid);
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) return unauthorized("2FA introuvable");

  let valid = verifyTotp(decryptField(user.twoFactorSecret), code);

  // Sinon, tenter un code de secours (usage unique).
  const codes = user.twoFactorBackupCodes;
  if (!valid && codes && codes.length > 0 && /^[A-Za-z0-9-]{6,}$/.test(code)) {
    for (let i = 0; i < codes.length; i++) {
      if (await comparePassword(code.toUpperCase(), codes[i])) {
        valid = true;
        codes.splice(i, 1);
        await user.save();
        break;
      }
    }
  }
  if (!valid) {
    await logAudit(
      {
        userId: user._id.toString(), tenantId: user.tenantId.toString(), email: user.email,
        role: user.role, tenantType: "pme", subscriptionStatus: "active", planModules: [],
      },
      "LOGIN_FAILED", "auth", { ip: clientIp(req), metadata: { step: "2fa" } }
    );
    return badRequest("Code incorrect");
  }

  const tenant = await TenantModel.findById(user.tenantId);
  if (!tenant) return unauthorized("Organisation introuvable");

  // Même contrôle d'abonnement que la connexion classique : sans lui, un compte
  // protégé par 2FA ouvrait une session là où un compte ordinaire était refusé.
  if (user.role !== "superadmin") {
    if (tenant.subscriptionStatus === "suspended" || tenant.subscriptionStatus === "cancelled") {
      return NextResponse.json(
        { success: false, error: "Abonnement inactif. Contactez le support." },
        { status: 402 }
      );
    }
  }

  resetRateLimit("2fa:verify", parsed.uid);

  user.lastLoginAt = new Date();
  await user.save();

  const tokenPayload = buildSessionPayload(user, tenant);

  await logAudit(tokenPayload, "LOGIN", "auth", { ip: clientIp(req), metadata: { method: "2fa" } });

  const response = NextResponse.json({
    success: true,
    data: { user: { id: user._id, email: user.email, role: user.role }, tenantType: tenant.type, role: user.role },
  });
  setSessionCookies(response, tokenPayload);
  response.cookies.set("twofa_token", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
