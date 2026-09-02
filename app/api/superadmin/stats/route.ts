import { NextRequest } from "next/server";
import { withAuth, ok, forbidden } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { UserModel } from "@/models/User";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  if (auth.role !== "superadmin") return forbidden();
  const [totalTenants, activeTenants, trialTenants, totalUsers, byType] = await Promise.all([
    TenantModel.countDocuments(),
    TenantModel.countDocuments({ subscriptionStatus: "active" }),
    TenantModel.countDocuments({ subscriptionStatus: "trial" }),
    UserModel.countDocuments({ isActive: true }),
    TenantModel.aggregate([{ $group: { _id: "$type", count: { $sum: 1 } } }]),
  ]);
  return ok({ totalTenants, activeTenants, trialTenants, totalUsers, byType });
});
