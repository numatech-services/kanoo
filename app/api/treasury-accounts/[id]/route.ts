import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("treasuryAccounts", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const item = await TreasuryAccountModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!item) return notFound(); return ok(item);
});
export const PATCH = withAuth("treasuryAccounts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const item = await TreasuryAccountModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!item) return notFound();
  await logAudit(auth, "UPDATE", "treasuryAccounts", { resourceId: params.id });
  return ok(item);
});
export const DELETE = withAuth("treasuryAccounts", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await TreasuryAccountModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) });
  await logAudit(auth, "DELETE", "treasuryAccounts", { resourceId: params.id });
  return noContent();
});
