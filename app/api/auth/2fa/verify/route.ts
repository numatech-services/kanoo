import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { badRequest, unauthorized } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { verifyTwoFactorChallenge, comparePassword } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { decryptField } from "@/lib/crypto-field";
import { setSessionCookies } from "@/lib/session";
import { logAudit } from "@/lib/audit";

// Étape 2 de la connexion : valide le code TOTP (ou un code de secours) puis ouvre la session.
export async function POST(req: NextRequest) {
  const challenge = req.cookies.get("twofa_token")?.value;
  const parsed = challenge ? verifyTwoFactorChallenge(challenge) : null;
  if (!parsed) return unauthorized("Session 2FA expirée. Reconnectez-vous.");

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
  if (!valid) return badRequest("Code incorrect");

  const tenant = await TenantModel.findById(user.tenantId);
  if (!tenant) return unauthorized("Organisation introuvable");

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

  await logAudit(tokenPayload, "LOGIN", "auth", { method: "2fa" });

  const response = NextResponse.json({
    success: true,
    data: { user: { id: user._id, email: user.email, role: user.role }, tenantType: tenant.type, role: user.role },
  });
  setSessionCookies(response, tokenPayload);
  response.cookies.set("twofa_token", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
