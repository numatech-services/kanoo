import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { EmployeeModel } from "@/models/Employee";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("employees", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const e = await EmployeeModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!e) return notFound(); return ok(e);
});
export const PATCH = withAuth("employees", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const e = await EmployeeModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!e) return notFound();
  await logAudit(auth, "UPDATE", "employees", { resourceId: params.id });
  return ok(e);
});
export const DELETE = withAuth("employees", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const e = await EmployeeModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { isActive: false }, { new: true });
  if (!e) return notFound();
  await logAudit(auth, "DELETE", "employees", { resourceId: params.id });
  return noContent();
});
