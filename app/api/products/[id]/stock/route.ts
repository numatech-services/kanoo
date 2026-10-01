import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { ProductModel } from "@/models/Product";
import { ProductStockModel } from "@/models/ProductStock";
import { WarehouseModel } from "@/models/Warehouse";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { StockLotModel } from "@/models/StockLot";
import { stockByWarehouse } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** GET — stock d'un article par entrepôt, et ses lots / numéros de série en stock. */
export const GET = withAuth("products", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return ok({ warehouses: [], lots: [] });
  const [warehouses, lots] = await Promise.all([
    stockByWarehouse(auth.tenantId, params.id),
    StockLotModel.find({ ...tenantFilter(auth), productId: new Types.ObjectId(params.id), qty: { $gt: 0 } })
      .populate("warehouseId", "code name").sort({ expiryDate: 1, receivedAt: 1 }).lean(),
  ]);
  return ok({ warehouses, lots });
});

/**
 * PATCH — { warehouseId, minAlert } : seuil d'alerte propre à un entrepôt
 * (null ou vide = pas de seuil propre). La quantité, elle, ne bouge que par mouvements.
 */
export const PATCH = withAuth("products", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!Types.ObjectId.isValid(params.id) || !Types.ObjectId.isValid(String(body.warehouseId))) return badRequest("Article ou entrepôt invalide.");
  const [product, wh] = await Promise.all([
    ProductModel.exists({ _id: params.id, ...tenantFilter(auth), isService: { $ne: true } }),
    WarehouseModel.exists({ _id: body.warehouseId, ...tenantFilter(auth) }),
  ]);
  if (!product || !wh) return notFound("Article ou entrepôt introuvable.");
  const raw = body.minAlert;
  const minAlert = raw === null || raw === "" || raw === undefined ? null : Number(raw);
  if (minAlert !== null && !(Number.isFinite(minAlert) && minAlert >= 0)) return badRequest("Seuil invalide.");
  await stockByWarehouse(auth.tenantId, params.id); // reprise éventuelle de l'ancien stock
  await ProductStockModel.updateOne(
    { tenantId: new Types.ObjectId(auth.tenantId), productId: new Types.ObjectId(params.id), warehouseId: new Types.ObjectId(String(body.warehouseId)) },
    minAlert === null ? { $unset: { minAlert: 1 } } : { $set: { minAlert }, $setOnInsert: { qty: 0 } },
    { upsert: minAlert !== null },
  );
  await logAudit(auth, "UPDATE", "products", { resourceId: params.id, after: { warehouseId: String(body.warehouseId), minAlert } });
  return ok({ minAlert });
});
