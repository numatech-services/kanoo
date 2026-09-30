import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { transferStock, StockError } from "@/lib/stock";
import { logAudit } from "@/lib/audit";

/**
 * POST — { fromWarehouseId, toWarehouseId, lines: [{ productId, quantity, lots? }], reason?, reference? }
 * Transfert d'un ou plusieurs articles entre entrepôts, tout ou rien.
 */
export const POST = withAuth("products", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const lines = Array.isArray(body.lines) ? body.lines : body.productId ? [body] : [];
  if (!lines.length) return badRequest("Aucun article à transférer.");
  const transferNumber = String(body.reference ?? "").trim().slice(0, 40) || `TR-${new Date().toISOString().slice(0, 10)}-${new Types.ObjectId().toString().slice(-4).toUpperCase()}`;
  try {
    const results = await withTransaction(async session => {
      const out = [];
      for (const l of lines) {
        out.push(await transferStock({
          tenantId: auth.tenantId, userId: auth.userId, productId: l.productId,
          fromWarehouseId: body.fromWarehouseId, toWarehouseId: body.toWarehouseId,
          quantity: Math.abs(Number(l.quantity)), lots: l.lots, reason: String(body.reason ?? "").trim(),
          linkedDocNumber: transferNumber,
        }, session));
      }
      return out;
    });
    await logAudit(auth, "UPDATE", "stock", { metadata: { transfer: transferNumber, lines: lines.length } });
    return created({ reference: transferNumber, count: results.length });
  } catch (e) {
    if (e instanceof StockError) return badRequest(e.message);
    throw e;
  }
});
