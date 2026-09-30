import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { StockLotModel } from "@/models/StockLot";

export const dynamic = "force-dynamic";

/** GET ?days=30 — lots en stock périmés ou arrivant à péremption. */
export const GET = withAuth("products", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 30));
  const limit = new Date(Date.now() + days * 86400000);
  const lots = await StockLotModel.find({ ...tenantFilter(auth), qty: { $gt: 0 }, expiryDate: { $ne: null, $lte: limit } })
    .populate("productId", "code label unit").populate("warehouseId", "code name").sort({ expiryDate: 1 }).limit(500).lean<Array<{ expiryDate: Date }>>();
  const now = Date.now();
  return ok({ days, expired: lots.filter(l => new Date(l.expiryDate).getTime() < now), soon: lots.filter(l => new Date(l.expiryDate).getTime() >= now) });
});
