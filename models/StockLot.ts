import { Schema, model, models } from "mongoose";

/**
 * Lot (ou numéro de série) d'un article dans un entrepôt : quantité restante,
 * date de péremption, coût d'entrée. Un numéro de série est un lot de 1.
 */
const StockLotSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
  lotNumber: { type: String, required: true, trim: true, maxlength: 80 },
  expiryDate: Date,
  qty: { type: Number, default: 0, min: 0 },
  unitCost: { type: Number, min: 0 },
  receivedAt: { type: Date, default: Date.now },
}, { timestamps: true });

StockLotSchema.index({ tenantId: 1, productId: 1, warehouseId: 1, lotNumber: 1 }, { unique: true });
StockLotSchema.index({ tenantId: 1, expiryDate: 1, qty: 1 });

export const StockLotModel = models.StockLot || model("StockLot", StockLotSchema);
