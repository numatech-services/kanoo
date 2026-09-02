import { Schema, model, models } from "mongoose";

// Enrichissement du modèle Product pour le stock
export const ProductStockSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },

  // Mouvement
  type: {
    type: String,
    enum: ["entry", "exit", "adjustment", "return", "loss"],
    required: true,
  },
  quantity: { type: Number, required: true }, // + entrée, - sortie
  quantityBefore: { type: Number, required: true },
  quantityAfter: { type: Number, required: true },

  // Référence
  reason: { type: String, required: true },
  linkedDocType: { type: String, enum: ["commande", "invoice", "delivery", "manual"] },
  linkedDocId: Schema.Types.ObjectId,
  linkedDocNumber: String,

  // Prix unitaire au mouvement
  unitCost: { type: Number, default: 0 },

  // Opérateur
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

ProductStockSchema.index({ tenantId: 1, productId: 1, createdAt: -1 });

export const StockMovementModel = models.StockMovement || model("StockMovement", ProductStockSchema);
