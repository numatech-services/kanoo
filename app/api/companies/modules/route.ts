import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { sanitizeModules } from "@/lib/modules";

/** Modules optionnels de l'organisation : lesquels sont masqués. */
export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const t = await TenantModel.findById(auth.tenantId).select("disabledModules").lean<{ disabledModules?: string[] } | null>();
  if (!t) return notFound("Organisation introuvable");
  return ok({ disabledModules: t.disabledModules ?? [] });
});

export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const disabledModules = sanitizeModules(body.disabledModules);
  const before = await TenantModel.findByIdAndUpdate(auth.tenantId, { $set: { disabledModules } })
    .select("disabledModules").lean<{ disabledModules?: string[] } | null>();
  if (!before) return notFound("Organisation introuvable");
  await logAudit(auth, "UPDATE", "companies", {
    resourceId: auth.tenantId, before: { disabledModules: before.disabledModules ?? [] }, after: { disabledModules },
  });
  return ok({ disabledModules });
});
