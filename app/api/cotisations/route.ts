import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { MembershipModel } from "@/models/Membership";
import { MemberModel } from "@/models/Member";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("cotisations", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const year = url.searchParams.get("year");
  const memberId = url.searchParams.get("memberId");
  const paid = url.searchParams.get("paid");
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (year) filter.year = parseInt(year);
  if (memberId) filter.memberId = memberId;
  if (paid === "true") filter.paidAt = { $exists: true };
  if (paid === "false") filter.paidAt = { $exists: false };
  const [items, total] = await Promise.all([
    MembershipModel.find(filter).populate("memberId", "firstName lastName code").sort({ year: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    MembershipModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("cotisations", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["memberId", "year", "amount"]);
  if (err) return badRequest(err);
  const member = await MemberModel.findOne({ _id: body.memberId, tenantId: auth.tenantId });
  if (!member) return badRequest("Adhérent introuvable");
  const year = new Date().getFullYear();
  const count = await MembershipModel.countDocuments({ tenantId: auth.tenantId });
  const receiptNumber = `REC-${year}-${String(count + 1).padStart(5, "0")}`;
  const membership = await MembershipModel.create({ ...body, tenantId: auth.tenantId, receiptNumber, paidAt: body.paid ? new Date() : undefined });
  await logAudit(auth, "CREATE", "cotisations", { resourceId: membership._id.toString() });
  return created(membership);
});
