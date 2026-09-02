import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { MemberModel } from "@/models/Member";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("membres", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const member = await MemberModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!member) return notFound();
  return ok(member);
});

export const PATCH = withAuth("membres", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const member = await MemberModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!member) return notFound();
  await logAudit(auth, "UPDATE", "membres", { resourceId: params.id });
  return ok(member);
});

export const DELETE = withAuth("membres", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const member = await MemberModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { status: "inactive" }, { new: true });
  if (!member) return notFound();
  await logAudit(auth, "DELETE", "membres", { resourceId: params.id });
  return noContent();
});
