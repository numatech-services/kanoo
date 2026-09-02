import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { CRMOpportunityModel } from "@/models/CRMOpportunity";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { nextDocumentNumber } from "@/lib/numbering";

export const GET = withAuth("clients", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage");
  const view = url.searchParams.get("view") || "pipeline"; // pipeline | list

  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (stage) filter.stage = stage;

  if (view === "pipeline") {
    // Retourner les opportunités groupées par stage (pour le Kanban)
    const stages = ["prospect","qualified","proposal","negotiation","won","lost"] as const;
    const result: Record<string, unknown[]> = {};
    await Promise.all(stages.map(async s => {
      result[s] = await CRMOpportunityModel.find({ ...tenantFilter(auth), stage: s })
        .populate("clientId", "name code")
        .populate("assignedTo", "firstName lastName")
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean();
    }));

    // Statistiques pipeline
    const stats = await CRMOpportunityModel.aggregate([
      { $match: { ...tenantFilter(auth), stage: { $nin: ["won","lost"] } } },
      { $group: {
        _id: null,
        totalPipelineValue: { $sum: "$estimatedAmount" },
        weightedValue: { $sum: { $multiply: ["$estimatedAmount", { $divide: ["$probability", 100] }] } },
        count: { $sum: 1 },
      }},
    ]);

    return ok({ pipeline: result, stats: stats[0] || {} });
  }

  const pagination = getPagination(req);
  const [items, total] = await Promise.all([
    CRMOpportunityModel.find(filter).populate("clientId", "name").sort({ updatedAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    CRMOpportunityModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("clients", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json();
  const err = requireFields(body, ["title"]);
  if (err) return badRequest(err);

  const reference = `OPP-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

  const opp = await CRMOpportunityModel.create({
    ...body, tenantId: auth.tenantId, reference,
    nextFollowUpDate: body.nextFollowUpDate || new Date(Date.now() + 7 * 86400000),
  });

  await logAudit(auth, "CREATE", "clients", { resourceId: opp._id.toString(), after: { reference, title: body.title, stage: body.stage || "prospect" } });
  return created(opp);
});
