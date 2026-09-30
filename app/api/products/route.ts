import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, conflict, getPagination, paginatedResponse, tenantFilter, requireFields } from "@/lib/api-helpers";
import { ProductModel } from "@/models/Product";
import { SupplierModel } from "@/models/Supplier";
import { productFields } from "@/lib/product-input";
import { applyMovement } from "@/lib/stock";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("products", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim();
  const isService = url.searchParams.get("isService");
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const filter: Record<string, unknown> = { ...tenantFilter(auth), ...(includeInactive ? {} : { isActive: true }) };
  if (search) {
    const rx = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ label: rx }, { code: rx }, { barcode: rx }];
  }
  if (isService !== null) filter.isService = isService === "true";
  const [items, total] = await Promise.all([
    ProductModel.find(filter).sort({ label: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    ProductModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

/**
 * POST — création d'un article. Le stock initial éventuel (`initialQty`,
 * `initialCost`) est enregistré comme une entrée : il apparaît dans
 * l'historique et fixe le coût moyen.
 */
export const POST = withAuth("products", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["label", "code", "unitPrice"]);
  if (err) return badRequest(err);
  const code = String(body.code).trim().slice(0, 40);
  if (!code) return badRequest("Code obligatoire.");
  const { data, error } = productFields(body);
  if (error) return badRequest(error);
  if (data.preferredSupplierId && !(await SupplierModel.exists({ ...tenantFilter(auth), _id: data.preferredSupplierId }))) return badRequest("Fournisseur introuvable.");
  if (await ProductModel.exists({ tenantId: auth.tenantId, code })) return conflict(`Code '${code}' déjà utilisé`);
  const initialQty = Number(body.initialQty ?? body.stockQty) || 0;
  if (initialQty < 0) return badRequest("Stock initial invalide.");

  const product = await withTransaction(async session => {
    const [p] = await ProductModel.create([{ ...data, code, stockQty: 0, purchaseCost: 0, tenantId: auth.tenantId }], { session });
    if (initialQty > 0 && !p.isService) {
      await applyMovement({
        tenantId: auth.tenantId, userId: auth.userId, productId: p._id, type: "entry", quantity: initialQty,
        unitCost: Number(body.initialCost ?? body.purchaseCost) || 0, reason: "Stock initial",
      }, session);
    }
    return p;
  });
  await logAudit(auth, "CREATE", "products", { resourceId: product._id.toString(), after: { code } });
  return created(await ProductModel.findById(product._id).lean());
});
