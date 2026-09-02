import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { DonationModel } from "@/models/Donation";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("dons", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const campaign = url.searchParams.get("campaign");
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (campaign) filter.campaign = campaign;
  const [items, total] = await Promise.all([
    DonationModel.find(filter).sort({ date: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    DonationModel.countDocuments(filter),
  ]);
  // Totaux par campagne
  const totals = await DonationModel.aggregate([
    { $match: { tenantId: { $in: [auth.tenantId] } } },
    { $group: { _id: "$currency", total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  return ok({ items, pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) }, totals });
});

export const POST = withAuth("dons", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["amount", "date", "donorType"]);
  if (err) return badRequest(err);
  
  // Convert date string to Date object
  const dateObj = body.date ? new Date(body.date) : new Date();
  const year = dateObj.getFullYear();
  const count = await DonationModel.countDocuments({ tenantId: auth.tenantId });
  const receiptNumber = `DON-${year}-${String(count + 1).padStart(5, "0")}`;
  
  const donation = await DonationModel.create({
    ...body,
    tenantId: auth.tenantId,
    date: dateObj,
    receiptNumber,
  });
  await logAudit(auth, "CREATE", "dons", { resourceId: donation._id.toString(), after: { amount: body.amount, currency: body.currency } });
  return created(donation);
});
