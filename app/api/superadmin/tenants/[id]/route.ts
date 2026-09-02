import { NextRequest } from "next/server";
import { withAuth, ok, notFound, forbidden } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  if (auth.role !== "superadmin") return forbidden();
  const tenant = await TenantModel.findById(params.id).lean();
  if (!tenant) return notFound();
  return ok(tenant);
});

export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (auth.role !== "superadmin") return forbidden();
  const body = await req.json();
  const tenant = await TenantModel.findByIdAndUpdate(params.id, body, { new: true });
  if (!tenant) return notFound();
  return ok(tenant);
});
