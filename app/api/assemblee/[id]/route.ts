import { NextRequest } from "next/server";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { GeneralAssemblyModel } from "@/models/GeneralAssembly";
import { TokenPayload } from "@/lib/auth";
export const GET = withAuth("assemblee", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const item = await GeneralAssemblyModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!item) return notFound(); return ok(item);
});
export const PATCH = withAuth("assemblee", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const item = await GeneralAssemblyModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!item) return notFound(); return ok(item);
});
