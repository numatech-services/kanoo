import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { badRequest, serverError } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { generateSecureToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.email) return badRequest("Email requis");

    await connectDB();

    const tenant = await TenantModel.findOne({ email: body.email.toLowerCase() });

    // Toujours répondre OK (ne pas révéler si l'email existe)
    if (tenant && tenant.subscriptionStatus !== "active") {
      const token = generateSecureToken();
      tenant.activationToken = token;
      // Expiration courte (2 h) pour limiter la fenêtre d'abus.
      tenant.activationTokenExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await tenant.save();

      // TODO: envoyer l'email d'activation contenant le lien avec ce token.
      // await sendActivationEmail(tenant.email, token);
      // NE JAMAIS journaliser le token (secret) : retiré volontairement.
    }

    return NextResponse.json({
      success: true,
      data: { message: "Si votre email est enregistré, vous recevrez un lien d'activation." },
    });
  } catch (err) {
    return serverError(err);
  }
}
