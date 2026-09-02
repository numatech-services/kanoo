import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { BureauMemberModel } from "@/models/BureauMember";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("membres", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await BureauMemberModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("memberId").populate("projectIds", "code name status executionRate startDate endDate").lean();
  if (!item) return notFound();
  return ok(item);
});

export const PATCH = withAuth("membres", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();
  const item = await BureauMemberModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!item) return notFound();
  return ok(item);
});
