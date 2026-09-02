import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { DocumentModel } from "@/models/Document";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("documents", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const item = await DocumentModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!item) return notFound(); return ok(item);
});
export const PATCH = withAuth("documents", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const item = await DocumentModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!item) return notFound();
  await logAudit(auth, "UPDATE", "documents", { resourceId: params.id });
  return ok(item);
});
export const DELETE = withAuth("documents", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await DocumentModel.findOneAndDelete({ _id: params.id, ...tenantFilter(auth) });
  await logAudit(auth, "DELETE", "documents", { resourceId: params.id });
  return noContent();
});
