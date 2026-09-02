import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, ok, unauthorized, badRequest } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { comparePassword } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { decryptField } from "@/lib/crypto-field";

// Désactive le 2FA après vérification (code TOTP courant OU mot de passe).
export async function POST(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return unauthorized();
  const { token, password } = await req.json();

  await connectDB();
  const user = await UserModel.findById(auth.userId);
  if (!user || !user.twoFactorEnabled) return badRequest("2FA non activé");

  const okCode = !!token && !!user.twoFactorSecret && verifyTotp(decryptField(user.twoFactorSecret), String(token));
  const okPass = !!password && (await comparePassword(String(password), user.passwordHash));
  if (!okCode && !okPass) return badRequest("Code ou mot de passe incorrect");

  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  user.twoFactorPending = undefined;
  user.twoFactorBackupCodes = undefined;
  await user.save();

  return ok({ disabled: true });
}
