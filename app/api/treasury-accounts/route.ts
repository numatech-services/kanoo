import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("treasuryAccounts", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const filter = { ...tenantFilter(auth), isActive: true };
  const [items, total] = await Promise.all([TreasuryAccountModel.find(filter).sort({ label: 1 }).skip(pagination.skip).limit(pagination.limit).lean(), TreasuryAccountModel.countDocuments(filter)]);
  return paginatedResponse(items, total, pagination);
});
export const POST = withAuth("treasuryAccounts", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["label", "type"]);
  if (err) return badRequest(err);
  const account = await TreasuryAccountModel.create({ ...body, tenantId: auth.tenantId });
  return created(account);
});
