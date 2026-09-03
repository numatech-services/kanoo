import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { badRequest, serverError } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { TenantModel } from "@/models/Tenant";
import { hashPassword } from "@/lib/auth";
import { passwordErrors } from "@/lib/password-policy";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/reset-password — poser le nouveau mot de passe.
 *
 * Le jeton reçu par courriel est comparé à son empreinte en base. À l'issue :
 * jeton consommé (usage unique), et **toutes les sessions révoquées** — si le
 * compte était compromis, c'est maintenant que l'intrus doit tomber.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = rateLimit("reset-password", ip, 10, 15 * 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Trop de tentatives. Réessayez dans quelques minutes." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "");
    const password = String(body.password || "");
    if (!token || !password) return badRequest("Jeton et nouveau mot de passe requis.");

    await connectDB();
    const hashed = crypto.createHash("sha256").update(token).digest("hex");
    const user = await UserModel.findOne({
      passwordResetToken: hashed,
      passwordResetExpiry: { $gt: new Date() },
      isActive: true,
    });

    if (!user) {
      return badRequest("Lien invalide ou expiré. Redemandez un lien depuis « Mot de passe oublié ».");
    }

    const tenant = await TenantModel.findById(user.tenantId).select("name")
      .lean<{ name?: string } | null>();
    const problems = passwordErrors(password, {
      email: user.email, firstName: user.firstName, lastName: user.lastName,
      tenantName: tenant?.name,
    });
    if (problems.length > 0) return badRequest(problems.join(" "));

    user.passwordHash = await hashPassword(password);
    user.passwordResetToken = undefined;
    user.passwordResetExpiry = undefined;
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    user.sessionVersion = (user.sessionVersion ?? 1) + 1;
    await user.save();

    return NextResponse.json({
      success: true,
      data: { message: "Mot de passe modifié. Toutes les sessions ouvertes ont été fermées — reconnectez-vous." },
    });
  } catch (err) {
    return serverError(err);
  }
}
