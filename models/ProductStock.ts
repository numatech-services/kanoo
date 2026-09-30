import { Schema, model, models } from "mongoose";

/** Quantité d'un article dans un entrepôt (une ligne par couple article × entrepôt). */
const ProductStockSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
  qty: { type: Number, default: 0 },
  /** Seuil d'alerte propre à cet entrepôt (sinon celui de l'article). */
  minAlert: { type: Number, min: 0 },
}, { timestamps: true });

ProductStockSchema.index({ tenantId: 1, productId: 1, warehouseId: 1 }, { unique: true });
ProductStockSchema.index({ tenantId: 1, warehouseId: 1 });

export const ProductStockModel = models.ProductStock || model("ProductStock", ProductStockSchema);
