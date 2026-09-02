import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, ok, unauthorized } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { generateSecret, buildOtpauthUri } from "@/lib/totp";
import { encryptField } from "@/lib/crypto-field";

// État du 2FA de l'utilisateur courant.
export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return unauthorized();
  await connectDB();
  const user = await UserModel.findById(auth.userId).select("twoFactorEnabled").lean() as { twoFactorEnabled?: boolean } | null;
  return ok({ enabled: !!user?.twoFactorEnabled });
}

// Démarre la configuration : génère un secret « en attente » + l'URI otpauth.
export async function POST(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return unauthorized();
  await connectDB();
  const user = await UserModel.findById(auth.userId);
  if (!user) return unauthorized();
  if (user.twoFactorEnabled) return ok({ alreadyEnabled: true });

  const secret = generateSecret();
  user.twoFactorPending = encryptField(secret); // chiffré au repos (AES-256-GCM)
  await user.save();

  // Le secret en clair n'est renvoyé qu'ici, une fois, pour le QR / la saisie manuelle.
  return ok({ secret, otpauth: buildOtpauthUri(secret, user.email, "Kanoo") });
}
