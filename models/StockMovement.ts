import { Schema, model, models } from "mongoose";

// Enrichissement du modèle Product pour le stock
export const ProductStockSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },

  // Mouvement
  type: {
    type: String,
    enum: ["entry", "exit", "adjustment", "return", "loss", "transfer"],
    required: true,
  },
  quantity: { type: Number, required: true }, // + entrée, - sortie
  quantityBefore: { type: Number, required: true },
  quantityAfter: { type: Number, required: true },

  // Référence
  reason: { type: String, required: true },
  linkedDocType: { type: String, enum: ["commande", "invoice", "delivery", "manual", "inventory", "reversal", "purchase", "transfer", "comptoir"] },
  linkedDocId: Schema.Types.ObjectId,
  linkedDocNumber: String,

  // Coût unitaire du mouvement (entrée : prix d'achat ; sortie : CMUP du moment)
  unitCost: { type: Number, default: 0 },
  /** Entrepôt concerné ; quantités avant / après = celles de cet entrepôt. */
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", index: true },
  /** Lots / numéros de série touchés, avec leur quantité signée. */
  lots: [{ _id: false, lotNumber: String, expiryDate: Date, qty: Number }],
  /** Transfert : identifiant commun aux deux jambes, et entrepôt opposé. */
  transferId: { type: Schema.Types.ObjectId, index: true },
  counterpartWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
  /** Stock total de l'article (tous entrepôts) après le mouvement. */
  totalAfter: Number,
  /** CMUP du produit après le mouvement. */
  avgCostAfter: Number,
  /** Annulation : le contre-mouvement qui annule celui-ci, et inversement. */
  reversedBy: { type: Schema.Types.ObjectId, ref: "StockMovement" },
  reverses: { type: Schema.Types.ObjectId, ref: "StockMovement" },

  // Opérateur
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

ProductStockSchema.index({ tenantId: 1, productId: 1, createdAt: -1 });
ProductStockSchema.index({ tenantId: 1, createdAt: -1 });
ProductStockSchema.index({ tenantId: 1, linkedDocNumber: 1 });

export const StockMovementModel = models.StockMovement || model("StockMovement", ProductStockSchema);
