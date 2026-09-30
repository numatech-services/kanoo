import { Schema, model, models, Types } from "mongoose";

/**
 * Mouvement de stock d'un comptoir (comptabilité matière) : entrée (achat,
 * réapprovisionnement), sortie (vente, consommation, casse) ou ajustement
 * d'inventaire. Trace figée : on garde la quantité après mouvement pour l'audit.
 */
export interface IActivityStockMove {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  itemId: Types.ObjectId;
  type: "in" | "out" | "adjust" | "supply";
  /** Quantité du mouvement (toujours positive ; le sens vient de `type`). */
  quantity: number;
  quantityAfter: number;
  unitCost?: number;
  reason?: string;
  stockMovementId?: Types.ObjectId;
  date: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActivityStockMoveSchema = new Schema<IActivityStockMove>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true, index: true },
  type: { type: String, enum: ["in", "out", "adjust", "supply"], required: true },
  quantity: { type: Number, required: true, min: 0 },
  quantityAfter: { type: Number, required: true },
  unitCost: { type: Number, min: 0 },
  reason: { type: String, maxlength: 300 },
  /** Mouvement de stock central correspondant (article lié au catalogue). */
  stockMovementId: { type: Schema.Types.ObjectId, ref: "StockMovement" },
  date: { type: Date, required: true, default: Date.now, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ActivityStockMoveSchema.index({ tenantId: 1, deskId: 1, date: -1 });

export const ActivityStockMoveModel = models.ActivityStockMove || model<IActivityStockMove>("ActivityStockMove", ActivityStockMoveSchema);
