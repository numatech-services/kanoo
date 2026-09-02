import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, serverError } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { TokenPayload } from "@/lib/auth";

export const POST = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.name) updates.name = body.name;
    if (body.nif) updates.nif = body.nif;
    if (body.rccm) updates.rccm = body.rccm;
    if (body.phone) updates.phone = body.phone;
    if (body.email) updates.email = body.email;
    if (body.address) updates.address = body.address;
    if (body.planComptable) updates["settings.planComptable"] = body.planComptable;
    if (typeof body.tvaActif !== "undefined") updates["settings.tvaActif"] = body.tvaActif;
    if (body.tvaRegime) updates["settings.tvaRegime"] = body.tvaRegime;
    updates["settings.onboardingCompleted"] = true;
    await TenantModel.findByIdAndUpdate(auth.tenantId, { $set: updates });
    return ok({ message: "Configuration enregistrée", redirect: "/dashboard" });
  } catch (err) {
    return serverError(err);
  }
});
