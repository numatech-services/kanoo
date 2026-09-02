import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { MembershipModel } from "@/models/Membership";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
export const GET = withAuth("cotisations", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const item = await MembershipModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!item) return notFound(); return ok(item);
});
export const PATCH = withAuth("cotisations", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const item = await MembershipModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!item) return notFound(); await logAudit(auth, "UPDATE", "cotisations", { resourceId: params.id }); return ok(item);
});
export const DELETE = withAuth("cotisations", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await MembershipModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) }); return noContent();
});
