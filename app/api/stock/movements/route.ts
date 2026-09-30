import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, forbidden, tenantFilter, requireFields, getPagination, paginatedResponse } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { StockMovementModel } from "@/models/StockMovement";
import { applyMovement, StockError, MOVEMENT_TYPES, MOVEMENT_LABEL, type MovementType } from "@/lib/stock";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function buildFilter(auth: TokenPayload, url: URL) {
  const filter: Record<string, unknown> = { ...tenantFilter(auth) };
  const productId = url.searchParams.get("productId");
  if (productId && Types.ObjectId.isValid(productId)) filter.productId = new Types.ObjectId(productId);
  const type = url.searchParams.get("type");
  if (type && (MOVEMENT_TYPES as readonly string[]).includes(type)) filter.type = type;
  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  if (from || to) {
    const r: Record<string, Date> = {};
    if (from) r.$gte = new Date(from);
    if (to) r.$lte = new Date(`${to}T23:59:59`);
    filter.createdAt = r;
  }
  const q = (url.searchParams.get("q") || "").trim();
  if (q) filter.$or = [{ reason: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }, { linkedDocNumber: q }];
  return filter;
}

/**
 * GET /api/stock/movements?productId=&type=&from=&to=&q=&format=csv
 * Journal des mouvements (tous produits ou un seul), filtrable, exportable.
 */
export const GET = withAuth("products", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const filter = buildFilter(auth, url);

  if (url.searchParams.get("format") === "csv") {
    if (isInternFor(auth, "products")) return forbidden(INTERN_EXPORT_MESSAGE);
    const rows = await StockMovementModel.find(filter).sort({ createdAt: -1 }).limit(20000)
      .populate("productId", "code label unit").populate("createdBy", "firstName lastName")
      .lean<Array<Record<string, unknown>>>();
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Date", "Code", "Article", "Type", "Quantité", "Avant", "Après", "Coût unitaire", "CMUP après", "Motif", "Document", "Par"].join(";")];
    for (const m of rows) {
      const p = (m.productId ?? {}) as { code?: string; label?: string };
      const u = (m.createdBy ?? {}) as { firstName?: string; lastName?: string };
      lines.push([new Date(String(m.createdAt)).toLocaleString("fr-FR"), p.code, p.label, MOVEMENT_LABEL[m.type as MovementType] ?? m.type,
        m.quantity, m.quantityBefore, m.quantityAfter, m.unitCost, m.avgCostAfter, m.reason, m.linkedDocNumber, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()].map(cell).join(";"));
    }
    return new NextResponse("﻿" + lines.join("\r\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="mouvements-stock-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }

  const pagination = getPagination(req);
  const [items, total] = await Promise.all([
    StockMovementModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit)
      .populate("productId", "code label unit").populate("createdBy", "firstName lastName").lean(),
    StockMovementModel.countDocuments(filter),
  ]);
  return paginatedResponse(items, total, pagination);
});

/** POST — { productId, type, quantity, unitCost?, reason } : saisie d'un mouvement. */
export const POST = withAuth("products", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["productId", "type", "quantity", "reason"]);
  if (err) return badRequest(err);
  if (!Types.ObjectId.isValid(String(body.productId))) return badRequest("Produit invalide.");
  try {
    const r = await withTransaction(session => applyMovement({
      tenantId: auth.tenantId, userId: auth.userId, productId: body.productId,
      type: body.type, quantity: Math.abs(Number(body.quantity)), unitCost: body.unitCost, reason: body.reason,
      linkedDocNumber: typeof body.reference === "string" ? body.reference.slice(0, 60) : undefined,
    }, session));
    await logAudit(auth, "UPDATE", "stock", { resourceId: String(body.productId), after: { type: body.type, delta: r.delta, stockQty: r.after } });
    return created({ movementId: r.movement._id, newQty: r.after, previousQty: r.before, avgCost: r.avgCost });
  } catch (e) {
    if (e instanceof StockError) return badRequest(e.message);
    throw e;
  }
});
