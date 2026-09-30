import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
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
