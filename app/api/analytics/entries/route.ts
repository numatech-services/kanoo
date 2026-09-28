import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { AnalyticEntryModel } from "@/models/AnalyticEntry";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth("analytics", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const pagination = getPagination(req);
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const activityId = url.searchParams.get("activityId");
  if (activityId === "general") filter.activityId = { $exists: false };
  else if (activityId && Types.ObjectId.isValid(activityId)) filter.activityId = activityId;
  const kind = url.searchParams.get("kind");
  if (kind === "revenue" || kind === "expense") filter.kind = kind;

  const [items, total] = await Promise.all([
    AnalyticEntryModel.find(filter).populate("activityId", "name color").sort({ date: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    AnalyticEntryModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
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
