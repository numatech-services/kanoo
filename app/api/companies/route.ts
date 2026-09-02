import { NextRequest } from "next/server";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const tenant = await TenantModel.findById(auth.tenantId).lean();
  if (!tenant) return notFound("Organisation introuvable");
  return ok(tenant);
});

export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  // Champs non modifiables par le tenant
  delete body.plan; delete body.planModules; delete body.subscriptionStatus; delete body.slug;
  const tenant = await TenantModel.findByIdAndUpdate(auth.tenantId, body, { new: true });
  if (!tenant) return notFound();
  await logAudit(auth, "UPDATE", "companies", { resourceId: auth.tenantId });
  return ok(tenant);
});
