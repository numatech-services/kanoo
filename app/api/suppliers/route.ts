import { NextRequest } from "next/server";
import { withAuth, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields, sanitizeBody, escapeRegex } from "@/lib/api-helpers";
import { SupplierModel, SUPPLIER_PROTECTED } from "@/models/Supplier";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("suppliers", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const search = escapeRegex(url.searchParams.get("search"));
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  if (search) filter.$or = [{ name: { $regex: search, $options: "i" } }, { code: { $regex: search, $options: "i" } }];
  // Mode sélecteur : tous les fournisseurs (la pagination plafonne à 100).
  if (url.searchParams.get("picker") === "1") {
    const items = await SupplierModel.find(filter).sort({ name: 1 }).limit(5000).select("name code nif email phone address isActive paymentTermDays currency").lean();
    return paginatedResponse(items, items.length, { page: 1, limit: items.length || 1, skip: 0 });
  }
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
  // Le code d'accès au portail fournisseur se génère par sa route : posé ici, il
  // permettait de se connecter au portail sous l'identité du fournisseur.
  const supplier = await SupplierModel.create({ ...sanitizeBody(body, SUPPLIER_PROTECTED), tenantId: auth.tenantId });
  await logAudit(auth, "CREATE", "suppliers", { resourceId: supplier._id.toString(), after: { code: body.code, name: body.name } });
  return created(supplier);
});
