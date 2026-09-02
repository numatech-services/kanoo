import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { badRequest, serverError } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.token) return badRequest("Token d'activation requis");

    await connectDB();

    const tenant = await TenantModel.findOne({
      activationToken: body.token,
      activationTokenExpiry: { $gt: new Date() },
    });

    if (!tenant) {
      return NextResponse.json(
        { error: "Token invalide ou expiré. Demandez un nouveau lien d'activation." },
        { status: 400 }
      );
    }

    tenant.subscriptionStatus = "trial";
    tenant.activatedAt = new Date();
    tenant.trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    tenant.activationToken = undefined;
    tenant.activationTokenExpiry = undefined;
    await tenant.save();

    return NextResponse.json({
      success: true,
      data: {
        message: "Compte activé avec succès. Votre période d'essai de 30 jours commence maintenant.",
        tenantName: tenant.name,
        trialEndsAt: tenant.trialEndsAt,
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
