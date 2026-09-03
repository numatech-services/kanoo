import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { badRequest, serverError } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { generateSecureToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmail, templateActivation } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/activation/request — renvoyer un lien d'activation.
 *
 * L'implémentation précédente régénérait le jeton **sans jamais envoyer le
 * courriel** (un TODO tenait lieu d'envoi). Résultat pire que l'inaction :
 * cliquer « Renvoyer le lien » invalidait l'ancien lien et n'en délivrait pas
 * de nouveau — l'utilisateur qui demandait de l'aide se verrouillait dehors.
 *
 * La réponse reste identique que l'adresse existe ou non : ce point-là était
 * juste, on le garde.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limit = rateLimit("activation-resend", ip, 5, 15 * 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Trop de demandes. Réessayez dans quelques minutes." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    if (!body.email) return badRequest("Email requis");

    await connectDB();

    const tenant = await TenantModel.findOne({ email: String(body.email).toLowerCase() });

    if (tenant && (tenant.subscriptionStatus === "pending_activation" || tenant.activationToken)) {
      const token = generateSecureToken();
      tenant.activationToken = token;
      tenant.activationTokenExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await tenant.save();

      const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
      await sendEmail({ ...templateActivation(tenant.name, token, baseUrl), to: tenant.email });
    }

    return NextResponse.json({
      success: true,
      data: { message: "Si votre email est enregistré, vous recevrez un lien d'activation." },
    });
  } catch (err) {
    return serverError(err);
  }
}
