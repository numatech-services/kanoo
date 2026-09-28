import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, noContent, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { AnalyticEntryModel } from "@/models/AnalyticEntry";

export const dynamic = "force-dynamic";

export const DELETE = withAuth("analytics", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const res = await AnalyticEntryModel.deleteOne({ _id: params.id, ...tenantFilter(auth) });
  if (!res.deletedCount) return notFound("Écriture introuvable");
  return noContent();
});
