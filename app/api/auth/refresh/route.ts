import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getTokenFromRequest, verifyToken, signToken } from "@/lib/auth";
import { UserModel } from "@/models/User";

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * POST /api/auth/refresh
 * Rafraîchit le token JWT si l'utilisateur est actif (appelé en arrière-plan)
 * Retourne un nouveau token avec iat reset
 */
export async function POST(req: NextRequest) {
  const token = getTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const auth = verifyToken(token);

    // Vérifier que la session n'est pas expirée par inactivité
    if (auth.iat) {
      const tokenAge = Date.now() - auth.iat * 1000;
      if (tokenAge > INACTIVITY_TIMEOUT_MS) {
        return NextResponse.json({ error: "Session expirée pour inactivité", code: "INACTIVITY_TIMEOUT" }, { status: 401 });
      }
    }

    await connectDB();

    // Vérifier que le sessionVersion correspond (protection contre révocation)
    const user = await UserModel.findById(auth.userId).select("sessionVersion isActive").lean() as
      { sessionVersion?: number; isActive?: boolean } | null;

    if (!user?.isActive) return NextResponse.json({ error: "Compte désactivé" }, { status: 401 });
    if (user.sessionVersion && auth.sessionVersion && user.sessionVersion > auth.sessionVersion) {
      return NextResponse.json({ error: "Session révoquée par un administrateur", code: "SESSION_REVOKED" }, { status: 401 });
    }

    // Émettre un nouveau token avec iat = maintenant
    const newToken = signToken({
      userId: auth.userId, tenantId: auth.tenantId, tenantType: auth.tenantType,
      role: auth.role, email: auth.email, subscriptionStatus: auth.subscriptionStatus,
      planModules: auth.planModules, allowedResources: auth.allowedResources,
      sessionVersion: user.sessionVersion || 1,
    });

    // Mettre à jour lastActivityAt
    await UserModel.findByIdAndUpdate(auth.userId, { lastActivityAt: new Date() });

    const res = NextResponse.json({ success: true });
    res.cookies.set("auth_token", newToken, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60,
    });
    return res;

  } catch {
    return NextResponse.json({ error: "Token invalide" }, { status: 401 });
  }
}
