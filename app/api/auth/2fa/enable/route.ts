import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, ok, unauthorized, badRequest } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { verifyTotp, generateBackupCodes } from "@/lib/totp";
import { hashPassword } from "@/lib/auth";
import { decryptField } from "@/lib/crypto-field";

// Valide le premier code et active le 2FA ; renvoie les codes de secours (une seule fois).
export async function POST(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return unauthorized();
  const { token } = await req.json();

  await connectDB();
  const user = await UserModel.findById(auth.userId);
  if (!user) return unauthorized();
  if (!user.twoFactorPending) return badRequest("Aucune configuration 2FA en cours");
  if (!verifyTotp(decryptField(user.twoFactorPending), String(token || ""))) return badRequest("Code incorrect. Vérifiez l'heure de votre téléphone.");

  const backupCodes = generateBackupCodes(10);
  const hashed = await Promise.all(backupCodes.map((c) => hashPassword(c)));

  user.twoFactorSecret = user.twoFactorPending;
  user.twoFactorPending = undefined;
  user.twoFactorEnabled = true;
  user.twoFactorBackupCodes = hashed;
  await user.save();

  return ok({ enabled: true, backupCodes });
}
