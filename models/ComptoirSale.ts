import { Schema, model, models, Types } from "mongoose";

/**
 * Ticket de caisse d'un comptoir : plusieurs articles, remises, TVA de
 * chaque article, paiements ventilés par moyen.
 *
 * Le COÛT de chaque ligne est figé au moment de la vente (coût moyen
 * pondéré lu à la sortie de stock) : la marge d'une vente passée ne change
 * plus quand le prix d'achat évolue. Avant, une « vente » n'était qu'une
 * sortie de stock et un encaissement libre, sans ligne ni coût.
 */
export interface ISaleLine {
  itemId: Types.ObjectId;
  productId?: Types.ObjectId;
  label: string;
  category?: string;
  quantity: number;
  /** Prix unitaire TTC affiché en caisse, avant remise. */
  unitPriceTTC: number;
  /** Remise en %, sur la ligne. */
  discount: number;
  tvaRate: number;
  totalTTC: number;
  totalHT: number;
  totalTVA: number;
  /** Coût unitaire figé (CMUP à la sortie) ; 0 = article non valorisé. */
  unitCost: number;
  costTotal: number;
  /** Marge brute HT de la ligne (null si l'article n'a pas de coût). */
  marginHT: number | null;
  stockMovementId?: Types.ObjectId;
  stockMoveId?: Types.ObjectId;
}

export interface ISalePayment {
  method: string;
  amount: number;
  treasuryAccountId?: Types.ObjectId;
}

const LineSchema = new Schema<ISaleLine>({
  itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true },
  productId: { type: Schema.Types.ObjectId, ref: "Product" },
  label: { type: String, required: true, maxlength: 160 },
  category: { type: String, maxlength: 80 },
  quantity: { type: Number, required: true, min: 0 },
  unitPriceTTC: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0, max: 100 },
  tvaRate: { type: Number, default: 0, min: 0, max: 0.5 },
  totalTTC: { type: Number, required: true },
  totalHT: { type: Number, required: true },
  totalTVA: { type: Number, required: true },
  unitCost: { type: Number, default: 0, min: 0 },
  costTotal: { type: Number, default: 0 },
  marginHT: { type: Number, default: null },
  stockMovementId: { type: Schema.Types.ObjectId, ref: "StockMovement" },
  stockMoveId: { type: Schema.Types.ObjectId, ref: "ActivityStockMove" },
}, { _id: false });

const ComptoirSaleSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true, index: true },
  number: { type: String, required: true },
  date: { type: Date, required: true, index: true },
  lines: { type: [LineSchema], required: true },
  totalTTC: { type: Number, required: true },
  totalHT: { type: Number, required: true },
  totalTVA: { type: Number, required: true },
  costTotal: { type: Number, default: 0 },
  /** Marge HT des lignes valorisées. */
  marginHT: { type: Number, default: 0 },
  payments: [{ _id: false, method: String, amount: Number, treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" } }],
  /** Rendu au client (espèces données − dû), information du ticket. */
  changeGiven: { type: Number, default: 0 },
  customerName: { type: String, maxlength: 120 },
  status: { type: String, enum: ["paid", "cancelled"], default: "paid", index: true },
  cancelledAt: Date,
  cancelReason: String,
  entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  cashierId: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ComptoirSaleSchema.index({ tenantId: 1, number: 1 }, { unique: true });
ComptoirSaleSchema.index({ tenantId: 1, deskId: 1, date: -1 });

export const ComptoirSaleModel = models.ComptoirSale || model("ComptoirSale", ComptoirSaleSchema);
