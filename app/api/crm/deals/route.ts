import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { CRMDealModel } from "@/models/CRMDeal";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

const STAGE_PROBABILITY: Record<string, number> = {
  prospect:10, contacted:20, qualified:40, proposal:60, negotiation:75, won:100, lost:0
};

export const GET = withAuth("clients", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage");
  const view = url.searchParams.get("view") || "kanban";
  const pagination = getPagination(req);

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (stage) filter.stage = stage;
  else if (view === "active") filter.stage = { $nin: ["won","lost"] };

  const [items, total] = await Promise.all([
    CRMDealModel.find(filter)
      .populate("clientId","name code").populate("ownerId","firstName lastName")
      .sort({ stage: 1, updatedAt: -1 })
      .skip(pagination.skip).limit(view === "kanban" ? 200 : pagination.limit).lean(),
    CRMDealModel.countDocuments(filter),
  ]);

  // Statistiques pipeline
  const pipeline = await CRMDealModel.aggregate([
    { $match: { tenantId: auth.tenantId, stage: { $nin: ["won","lost"] } } },
    { $group: { _id: "$stage", count: { $sum: 1 }, totalAmount: { $sum: "$amount" }, weightedAmount: { $sum: { $multiply: ["$amount", { $divide: ["$probability", 100] }] } } } },
  ]);

  return ok({ items, total, pipeline });
});

export const POST = withAuth("clients", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const err = requireFields(body, ["title"]);
  if (err) return badRequest(err);

  const deal = await CRMDealModel.create({
    ...body,
    tenantId: auth.tenantId,
    probability: body.probability ?? STAGE_PROBABILITY[body.stage || "prospect"],
    ownerId: body.ownerId || auth.userId,
    nextFollowUpAt: body.nextFollowUpAt || new Date(Date.now() + 3 * 86400000),
  });
  await logAudit(auth, "CREATE", "clients", { resourceId: deal._id.toString(), after: { title: body.title, stage: body.stage } });
  return created(deal);
});
