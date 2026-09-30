import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { ProductStockModel } from "@/models/ProductStock";
import { StockLotModel } from "@/models/StockLot";
import { ensureStockRows } from "@/lib/stock";
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
  // Passage au suivi par lot / série : le stock existant est rangé dans un lot
  // « SANS-LOT » par entrepôt, pour que les sorties restent possibles.
  if (data.trackingMode && data.trackingMode !== "none") {
    const cur = await ProductModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("trackingMode stockQty label purchaseCost isService").lean<{ _id: Types.ObjectId; trackingMode?: string; stockQty?: number; label: string; purchaseCost?: number } | null>();
    if (cur && (cur.trackingMode ?? "none") === "none" && (cur.stockQty ?? 0) > 0) {
      if (data.trackingMode === "serial") return badRequest("Du stock existe sans numéros de série : passez par le suivi par lot, ou soldez le stock avant.");
      await ensureStockRows(auth.tenantId, { ...cur, trackingMode: "none" });
      const rows = await ProductStockModel.find({ ...tenantFilter(auth), productId: cur._id, qty: { $gt: 0 } }).lean<Array<{ warehouseId: Types.ObjectId; qty: number }>>();
      for (const r of rows) {
        await StockLotModel.updateOne({ ...tenantFilter(auth), productId: cur._id, warehouseId: r.warehouseId, lotNumber: "SANS-LOT" },
          { $set: { qty: r.qty }, $setOnInsert: { unitCost: cur.purchaseCost ?? 0, receivedAt: new Date() } }, { upsert: true });
      }
    }
  }
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
