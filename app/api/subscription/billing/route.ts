import { NextRequest } from "next/server";
import { withAuth, ok } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { TokenPayload } from "@/lib/auth";
export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const tenant = await TenantModel.findById(auth.tenantId).select("plan planModules subscriptionStatus trialEndsAt subscriptionEndsAt").lean();
  return ok(tenant);
});
