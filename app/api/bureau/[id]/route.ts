import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent, notFound, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { BureauMemberModel } from "@/models/BureauMember";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("bureau", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await BureauMemberModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("memberId").populate("projectIds", "code name status executionRate startDate endDate").lean();
  if (!item) return notFound();
  return ok(item);
});

export const PATCH = withAuth("bureau", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();
  const item = await BureauMemberModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, sanitizeBody(body), { new: true });
  if (!item) return notFound();
  return ok(item);
});

/** DELETE — retire un membre du bureau (droit « bureau », pas celui des adhérents). */
export const DELETE = withAuth("bureau", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await BureauMemberModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) });
  if (!item) return notFound();
  await logAudit(auth, "DELETE", "bureau", { resourceId: String(params.id) });
  return noContent();
});
