import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { DonationModel } from "@/models/Donation";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
export const GET = withAuth("dons", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const item = await DonationModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!item) return notFound(); return ok(item);
});
export const PATCH = withAuth("dons", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const item = await DonationModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!item) return notFound(); await logAudit(auth, "UPDATE", "dons", { resourceId: params.id }); return ok(item);
});
export const DELETE = withAuth("dons", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await DonationModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) }); return noContent();
});
