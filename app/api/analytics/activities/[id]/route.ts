import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ActivityModel } from "@/models/Activity";
import { AnalyticEntryModel } from "@/models/AnalyticEntry";

export const dynamic = "force-dynamic";

export const PATCH = withAuth("analytics", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const set: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) set.name = body.name.trim().slice(0, 120);
  if (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) set.color = body.color;
  if (body.archived !== undefined) set.archived = Boolean(body.archived);
  const item = await ActivityModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: set }, { new: true }).lean();
  if (!item) return notFound("Secteur introuvable");
  return ok(item);
});

/** DELETE — supprime un secteur ; ses écritures repassent en « frais généraux ». */
export const DELETE = withAuth("analytics", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const res = await ActivityModel.deleteOne({ _id: params.id, ...tenantFilter(auth) });
  if (!res.deletedCount) return notFound("Secteur introuvable");
  await AnalyticEntryModel.updateMany({ activityId: params.id, ...tenantFilter(auth) }, { $unset: { activityId: "" } });
  return noContent();
});
