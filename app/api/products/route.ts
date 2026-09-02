import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { ProductModel } from "@/models/Product";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("products", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const isService = url.searchParams.get("isService");
  const filter: Record<string, unknown> = { ...tenantFilter(auth), isActive: true };
  if (search) filter.$or = [{ label: { $regex: search, $options: "i" } }, { code: { $regex: search, $options: "i" } }];
  if (isService !== null) filter.isService = isService === "true";
  const [items, total] = await Promise.all([
    ProductModel.find(filter).sort({ label: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    ProductModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

export const POST = withAuth("products", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  const err = requireFields(body, ["label", "code", "unitPrice"]);
  if (err) return badRequest(err);
  const existing = await ProductModel.findOne({ tenantId: auth.tenantId, code: body.code });
  if (existing) return conflict(`Code '${body.code}' déjà utilisé`);
  const product = await ProductModel.create({ ...body, tenantId: auth.tenantId });
  await logAudit(auth, "CREATE", "products", { resourceId: product._id.toString() });
  return created(product);
});
