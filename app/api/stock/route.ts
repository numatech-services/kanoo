import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, getPagination, tenantFilter } from "@/lib/api-helpers";
import { Types } from "mongoose";
import { ProductModel } from "@/models/Product";
import { ProductStockModel } from "@/models/ProductStock";
import { StockLotModel } from "@/models/StockLot";
import { migrateLegacyStock } from "@/lib/stock";
import { TokenPayload } from "@/lib/auth";

// Alerte : article stocké (pas un service) avec un seuil défini, à ou sous le seuil.
const ALERT = { isService: { $ne: true }, stockMinAlert: { $gt: 0 }, $expr: { $lte: ["$stockQty", "$stockMinAlert"] } };

/**
 * GET /api/stock?search=&category=&location=&alertOnly=true
 * État du stock : quantités, CMUP, valeur au coût (à défaut, au prix de vente),
 * quantité à commander (jusqu'au stock maximal).
 */
export const GET = withAuth("products", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const tf = tenantFilter(auth);
  const search = (url.searchParams.get("search") || "").trim();
  const category = url.searchParams.get("category");
  const location = url.searchParams.get("location");
  const alertOnly = url.searchParams.get("alertOnly") === "true";
  const warehouseId = url.searchParams.get("warehouseId");
  await migrateLegacyStock(auth.tenantId);

  const filter: Record<string, unknown> = { ...tf, isActive: true, isService: { $ne: true } };
  if (alertOnly) Object.assign(filter, ALERT);
  if (category) filter.category = category;
  if (location) filter.location = location;
  if (search) {
    const rx = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ label: rx }, { code: rx }, { barcode: rx }];
  }

  if (warehouseId && Types.ObjectId.isValid(warehouseId)) {
    filter._id = { $in: await ProductStockModel.distinct("productId", { ...tf, warehouseId: new Types.ObjectId(warehouseId), qty: { $ne: 0 } }) };
  }
  const [items, total, alertCount, valueAgg, categories, locations] = await Promise.all([
    ProductModel.find(filter).sort({ stockQty: 1, label: 1 }).skip(pagination.skip).limit(pagination.limit)
      .populate("preferredSupplierId", "name code").lean<Array<Record<string, unknown> & { stockQty?: number; stockMinAlert?: number; stockMaxAlert?: number; purchaseCost?: number; unitPrice?: number }>>(),
    ProductModel.countDocuments(filter),
    ProductModel.countDocuments({ ...tf, isActive: true, ...ALERT }),
    ProductModel.aggregate([
      { $match: { ...tf, isActive: true, isService: { $ne: true } } },
      { $group: {
        _id: null,
        atCost: { $sum: { $multiply: [{ $ifNull: ["$stockQty", 0] }, { $ifNull: ["$purchaseCost", 0] }] } },
        atPrice: { $sum: { $multiply: [{ $ifNull: ["$stockQty", 0] }, { $ifNull: ["$unitPrice", 0] }] } },
        uncosted: { $sum: { $cond: [{ $and: [{ $gt: ["$stockQty", 0] }, { $lte: [{ $ifNull: ["$purchaseCost", 0] }, 0] }] }, 1, 0] } },
      } },
    ]),
    ProductModel.distinct("category", { ...tf, isActive: true, category: { $nin: [null, ""] } }),
    ProductModel.distinct("location", { ...tf, isActive: true, location: { $nin: [null, ""] } }),
  ]);
  const soon = new Date(Date.now() + 30 * 86400000);
  const [expiredLots, expiringLots] = await Promise.all([
    StockLotModel.countDocuments({ ...tf, qty: { $gt: 0 }, expiryDate: { $ne: null, $lt: new Date() } }),
    StockLotModel.countDocuments({ ...tf, qty: { $gt: 0 }, expiryDate: { $gte: new Date(), $lte: soon } }),
  ]);

  // Vue d'un entrepôt : quantités de cet entrepôt (et son seuil propre s'il en a un).
  let whQty: Map<string, { qty: number; minAlert?: number }> | null = null;
  if (warehouseId && Types.ObjectId.isValid(warehouseId)) {
    const rows = await ProductStockModel.find({ ...tf, warehouseId: new Types.ObjectId(warehouseId), productId: { $in: items.map(p => p._id) } })
      .lean<Array<{ productId: Types.ObjectId; qty: number; minAlert?: number }>>();
    whQty = new Map(rows.map(r => [String(r.productId), { qty: r.qty, minAlert: r.minAlert }]));
  }
  const enriched = items.map(p => {
    if (whQty) {
      const w = whQty.get(String(p._id)) ?? { qty: 0 };
      p = { ...p, totalQty: p.stockQty, stockQty: w.qty, ...(w.minAlert != null ? { stockMinAlert: w.minAlert } : {}) };
    }
    const qty = p.stockQty || 0, min = p.stockMinAlert || 0, max = p.stockMaxAlert || 0;
    return {
      ...p,
      isAlert: min > 0 && qty <= min,
      stockValue: qty * (p.purchaseCost || 0),
      stockValueAtPrice: qty * (p.unitPrice || 0),
      suggestedOrder: max > qty ? max - qty : min > 0 && qty <= min ? Math.max(min * 2 - qty, 1) : 0,
    };
  });
  const v = valueAgg[0] ?? { atCost: 0, atPrice: 0, uncosted: 0 };

  return ok({
    items: enriched,
    pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
    alertCount,
    // Valeur au coût (CMUP). La valeur au prix de vente reste indiquée à part.
    totalStockValue: v.atCost,
    totalStockValueAtPrice: v.atPrice,
    uncostedCount: v.uncosted,
    expiredLots, expiringLots,
    categories: (categories as string[]).sort(),
    locations: (locations as string[]).sort(),
  });
});
