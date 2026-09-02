import { NextRequest } from "next/server";
import { withAuth, ok, notFound } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { TokenPayload } from "@/lib/auth";
export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const t = await TenantModel.findById(auth.tenantId).select("name logo branding nif rccm address phone email").lean();
  if (!t) return notFound(); return ok(t);
});
export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const t = await TenantModel.findByIdAndUpdate(auth.tenantId, { $set: { logo: body.logo, "branding.primaryColor": body.primaryColor, "branding.secondaryColor": body.secondaryColor } }, { new: true });
  if (!t) return notFound(); return ok(t);
});
