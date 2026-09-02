import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { BudgetChapterModel } from "@/models/BudgetChapter";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("budgetChapters", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const item = await BudgetChapterModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!item) return notFound(); return ok(item);
});
export const PATCH = withAuth("budgetChapters", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const item = await BudgetChapterModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!item) return notFound();
  await logAudit(auth, "UPDATE", "budgetChapters", { resourceId: params.id });
  return ok(item);
});
export const DELETE = withAuth("budgetChapters", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await BudgetChapterModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) });
  await logAudit(auth, "DELETE", "budgetChapters", { resourceId: params.id });
  return noContent();
});
