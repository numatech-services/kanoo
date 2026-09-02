import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { GeneralAssemblyModel } from "@/models/GeneralAssembly";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("assemblee", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const [items, total] = await Promise.all([
    GeneralAssemblyModel.find({ ...tenantFilter(auth) }).sort({ date: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    GeneralAssemblyModel.countDocuments({ ...tenantFilter(auth) }),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("assemblee", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["title", "type", "date", "location"]);
  if (err) return badRequest(err);
  
  // Convert date string to Date object
  const data = {
    ...body,
    tenantId: auth.tenantId,
    date: body.date ? new Date(body.date) : new Date(),
  };
  
  const ag = await GeneralAssemblyModel.create(data);
  await logAudit(auth, "CREATE", "assemblee", { resourceId: ag._id.toString(), after: { title: body.title, date: body.date } });
  return created(ag);
});
