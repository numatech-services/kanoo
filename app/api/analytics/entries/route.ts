import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { AnalyticEntryModel } from "@/models/AnalyticEntry";
import { logAudit } from "@/lib/audit";
import { parseFlow, parsePeriod, periodMatch, flowTotals } from "@/lib/flow-filter";

export const dynamic = "force-dynamic";

/** GET ?activityId=&flow=in|out (ou kind=revenue|expense)&from=&to= — écritures analytiques, avec totaux de la période. */
export const GET = withAuth("analytics", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const pagination = getPagination(req);
  const base: Record<string, unknown> = { ...tenantFilter(auth), ...periodMatch("date", parsePeriod(url)) };
  const activityId = url.searchParams.get("activityId");
  if (activityId === "general") base.activityId = { $exists: false };
  else if (activityId && Types.ObjectId.isValid(activityId)) base.activityId = new Types.ObjectId(activityId);
  const flow = parseFlow(url.searchParams.get("flow"));
  const kindParam = url.searchParams.get("kind");
  const kind = flow === "in" ? "revenue" : flow === "out" ? "expense" : kindParam === "revenue" || kindParam === "expense" ? kindParam : null;
  const filter = kind ? { ...base, kind } : base;

  const [items, total, sums] = await Promise.all([
    AnalyticEntryModel.find(filter).populate("activityId", "name color").sort({ date: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    AnalyticEntryModel.countDocuments(filter),
    AnalyticEntryModel.aggregate<{ _id: string; total: number }>([{ $match: base }, { $group: { _id: "$kind", total: { $sum: "$amount" } } }]),
  ]);
  const sum = (k: string) => sums.find(x => x._id === k)?.total ?? 0;
  return paginatedResponse(items, total, pagination, { totals: flowTotals(sum("revenue"), sum("expense")) });
});

export const POST = withAuth("analytics", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const label = String(body.label || "").trim();
  const amount = Number(body.amount);
  if (!label) return badRequest("Libellé requis.");
  if (!amount || amount <= 0) return badRequest("Montant invalide.");
  if (body.kind !== "revenue" && body.kind !== "expense") return badRequest("Type invalide (recette ou dépense).");

  const item = await AnalyticEntryModel.create({
    tenantId: auth.tenantId,
    activityId: body.activityId && Types.ObjectId.isValid(String(body.activityId)) ? body.activityId : undefined,
    kind: body.kind, label: label.slice(0, 200), amount,
    date: body.date ? new Date(body.date) : new Date(),
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "analytics", { resourceId: item._id.toString(), metadata: { kind: body.kind, amount } });
  return created(item);
});
