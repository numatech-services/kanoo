import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { buildSessionPayload, setSessionCookies } from "@/lib/session";
import { verifyCsrf, CSRF_MESSAGES } from "@/lib/csrf";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * POST /api/auth/refresh
 * Prolonge la session d'un utilisateur actif.
 *
 * La charge utile est **reconstruite depuis la base**, jamais recopiée depuis
 * l'ancien jeton : sinon un rôle rétrogradé ou un abonnement suspendu seraient
 * reconduits indéfiniment, le rafraîchissement se déclenchant toutes les
 * 30 minutes d'activité.
 */
export async function POST(req: NextRequest) {
  const token = getTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const verdict = verifyCsrf(req);
  if (verdict !== "ok") {
    return NextResponse.json({ error: CSRF_MESSAGES[verdict] }, { status: 403 });
  }

  try {
    const auth = verifyToken(token);

    // Vérifier que la session n'est pas expirée par inactivité
    if (auth.iat) {
      const tokenAge = Date.now() - auth.iat * 1000;
      if (tokenAge > INACTIVITY_TIMEOUT_MS) {
        return NextResponse.json(
          { error: "Session expirée pour inactivité", code: "INACTIVITY_TIMEOUT" },
          { status: 401 }
        );
      }
    }

    await connectDB();

    const user = await UserModel.findById(auth.userId)
      .select("sessionVersion isActive role email allowedResources tenantId")
      .lean<{
        _id: { toString(): string };
        tenantId: { toString(): string };
        role: string;
        email: string;
        allowedResources?: string[];
        sessionVersion?: number;
        isActive?: boolean;
      } | null>();

    if (!user?.isActive) return NextResponse.json({ error: "Compte désactivé" }, { status: 401 });

    const currentVersion = user.sessionVersion ?? 1;
    if ((auth.sessionVersion ?? 0) < currentVersion) {
      return NextResponse.json(
        { error: "Session révoquée par un administrateur", code: "SESSION_REVOKED" },
        { status: 401 }
      );
    }

    const tenant = await TenantModel.findById(user.tenantId)
      .select("type subscriptionStatus planModules")
      .lean<{ type: string; subscriptionStatus: string; planModules: string[] } | null>();

    if (!tenant) return NextResponse.json({ error: "Organisation introuvable" }, { status: 401 });

    if (user.role !== "superadmin") {
      if (tenant.subscriptionStatus === "suspended" || tenant.subscriptionStatus === "cancelled") {
        return NextResponse.json({ error: "Abonnement inactif", code: "SUBSCRIPTION_INACTIVE" }, { status: 402 });
      }
    }

    await UserModel.findByIdAndUpdate(auth.userId, { lastActivityAt: new Date() });

    const res = NextResponse.json({ success: true });
    // setSessionCookies aligne la durée du cookie sur celle du jeton : les deux
    // divergeaient (8 h pour le JWT, 7 jours pour le cookie), ce qui produisait
    // des 401 sur une session que le navigateur croyait encore ouverte.
    setSessionCookies(res, buildSessionPayload(user, tenant));
    return res;

  } catch {
    return NextResponse.json({ error: "Token invalide" }, { status: 401 });
  }
}
