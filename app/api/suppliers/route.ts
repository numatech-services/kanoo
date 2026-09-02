import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { SupplierModel } from "@/models/Supplier";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("suppliers", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (search) filter.$or = [{ name: { $regex: search, $options: "i" } }, { code: { $regex: search, $options: "i" } }];
  const [items, total] = await Promise.all([
    SupplierModel.find(filter).sort({ name: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    SupplierModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("suppliers", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["name", "code"]);
  if (err) return badRequest(err);
  const existing = await SupplierModel.findOne({ tenantId: auth.tenantId, code: body.code });
  if (existing) return conflict(`Code '${body.code}' déjà utilisé`);
  const supplier = await SupplierModel.create({ ...body, tenantId: auth.tenantId });
  await logAudit(auth, "CREATE", "suppliers", { resourceId: supplier._id.toString(), after: { code: body.code, name: body.name } });
  return created(supplier);
});
