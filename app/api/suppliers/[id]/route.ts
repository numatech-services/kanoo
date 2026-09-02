import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { SupplierModel } from "@/models/Supplier";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("suppliers", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const s = await SupplierModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!s) return notFound();
  return ok(s);
});
export const PATCH = withAuth("suppliers", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const s = await SupplierModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!s) return notFound();
  await logAudit(auth, "UPDATE", "suppliers", { resourceId: params.id });
  return ok(s);
});
export const DELETE = withAuth("suppliers", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const s = await SupplierModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { isActive: false }, { new: true });
  if (!s) return notFound();
  await logAudit(auth, "DELETE", "suppliers", { resourceId: params.id });
  return noContent();
});
