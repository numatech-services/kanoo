import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/app-url";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { badRequest, serverError } from "@/lib/api-helpers";
import { UserModel } from "@/models/User";
import { generateSecureToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmail, templatePasswordReset } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/forgot-password — « J'ai oublié mon mot de passe. »
 *
 * Cette route n'existait pas : `passwordResetToken` était un champ mort et
 * `templatePasswordReset` un modèle jamais appelé. Un mot de passe oublié
 * était un compte perdu, sauf à connaître un administrateur.
 *
 * Trois règles :
 * - **Réponse identique que l'adresse existe ou non.** La différence de
 *   message est un annuaire des comptes offert à qui énumère.
 * - **Le jeton est haché en base.** En clair, une lecture de la base (fuite,
 *   sauvegarde égarée) donnerait des liens de réinitialisation valides pour
 *   tous les comptes en attente.
 * - **Un seul jeton actif** : chaque demande remplace la précédente.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = rateLimit("forgot-password", ip, 5, 15 * 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Trop de demandes. Réessayez dans quelques minutes." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return badRequest("Email requis");

    await connectDB();
    const user = await UserModel.findOne({ email, isActive: true });

    if (user) {
      const token = generateSecureToken();
      user.passwordResetToken = crypto.createHash("sha256").update(token).digest("hex");
      user.passwordResetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 h
      await user.save();

      const baseUrl = appBaseUrl();
      const payload = templatePasswordReset(`${baseUrl}/reinitialiser?token=${token}`);
      await sendEmail({ ...payload, to: user.email });
    }

    return NextResponse.json({
      success: true,
      data: { message: "Si cette adresse correspond à un compte, un lien de réinitialisation vient de partir. Il est valable une heure." },
    });
  } catch (err) {
    return serverError(err);
  }
}
