import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
import { ProductModel } from "@/models/Product";
import { SupplierModel } from "@/models/Supplier";
import { productFields } from "@/lib/product-input";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("products", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await ProductModel.findOne({ _id: params.id, ...tenantFilter(auth) }).populate("preferredSupplierId", "name code").lean();
  if (!p) return notFound();
  return ok(p);
});

/** PATCH — fiche article (jamais la quantité ni le coût moyen : mouvements). */
export const PATCH = withAuth("products", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const { data, error } = productFields(await req.json().catch(() => ({})));
  if (error) return badRequest(error);
  if (data.preferredSupplierId && !(await SupplierModel.exists({ ...tenantFilter(auth), _id: data.preferredSupplierId }))) return badRequest("Fournisseur introuvable.");
  const p = await ProductModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: data }, { new: true, runValidators: true });
  if (!p) return notFound();
  await logAudit(auth, "UPDATE", "products", { resourceId: params.id, after: data });
  return ok(p);
});

/** DELETE — désactive l'article (l'historique et les documents restent). */
export const DELETE = withAuth("products", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const p = await ProductModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: { isActive: false } }, { new: true });
  if (!p) return notFound();
  await logAudit(auth, "DELETE", "products", { resourceId: params.id });
  return noContent();
});
