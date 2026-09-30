import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, noContent, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { WarehouseModel } from "@/models/Warehouse";
import { ProductStockModel } from "@/models/ProductStock";
import { StockMovementModel } from "@/models/StockMovement";
import { logAudit } from "@/lib/audit";

/** PATCH — nom, adresse, notes, entrepôt par défaut, activation (vide seulement). */
export const PATCH = withAuth("products", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const w = await WarehouseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!w) return notFound("Entrepôt introuvable");
  if ("name" in body) { const n = String(body.name ?? "").trim(); if (!n) return badRequest("Nom obligatoire."); w.name = n.slice(0, 120); }
  if ("address" in body) w.address = String(body.address ?? "").slice(0, 240);
  if ("notes" in body) w.notes = String(body.notes ?? "").slice(0, 500);
  if (body.isDefault === true) {
    if (w.kind === "comptoir") return badRequest("Une réserve de comptoir ne peut pas être l'entrepôt par défaut.");
    await WarehouseModel.updateMany({ ...tenantFilter(auth), _id: { $ne: w._id } }, { $set: { isDefault: false } });
    w.isDefault = true; w.isActive = true;
  }
  if (body.isActive === false) {
    if (w.isDefault) return badRequest("Désignez d'abord un autre entrepôt par défaut.");
    if (await ProductStockModel.exists({ ...tenantFilter(auth), warehouseId: w._id, qty: { $ne: 0 } })) return badRequest("L'entrepôt contient du stock : transférez-le avant de le désactiver.");
    w.isActive = false;
  } else if (body.isActive === true) w.isActive = true;
  await w.save();
  await logAudit(auth, "UPDATE", "products", { resourceId: params.id, metadata: { warehouse: w.code } });
  return ok(w);
});

/** DELETE — un entrepôt jamais mouvementé. */
export const DELETE = withAuth("products", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const w = await WarehouseModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!w) return notFound("Entrepôt introuvable");
  if (w.isDefault || w.kind === "comptoir") return badRequest("Cet entrepôt ne se supprime pas (par défaut ou réserve de comptoir).");
  if (await StockMovementModel.exists({ ...tenantFilter(auth), warehouseId: w._id })) return badRequest("Des mouvements existent : désactivez l'entrepôt plutôt.");
  await ProductStockModel.deleteMany({ ...tenantFilter(auth), warehouseId: w._id });
  await WarehouseModel.deleteOne({ _id: w._id });
  await logAudit(auth, "DELETE", "products", { resourceId: params.id, metadata: { warehouse: w.code } });
  return noContent();
});
