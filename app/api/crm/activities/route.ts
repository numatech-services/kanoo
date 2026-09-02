import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, requireFields, tenantFilter } from "@/lib/api-helpers";
import { CRMActivityModel } from "@/models/CRMActivity";
import { CRMDealModel } from "@/models/CRMDeal";
import { TokenPayload } from "@/lib/auth";

export const POST = withAuth("clients", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const err = requireFields(body, ["dealId","type","title"]);
  if (err) return badRequest(err);

  const activity = await CRMActivityModel.create({ ...body, tenantId: auth.tenantId, createdBy: auth.userId });
  await CRMDealModel.findByIdAndUpdate(body.dealId, {
    lastActivityAt: new Date(),
    $inc: { followUpCount: 1 },
    nextFollowUpAt: body.nextFollowUpAt || new Date(Date.now() + 7 * 86400000),
  });
  return created(activity);
});
