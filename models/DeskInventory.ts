import { Schema, model, models, Types } from "mongoose";

/**
 * Inventaire d'un comptoir, au comptoir (stock de vente) ou à la réserve
 * (stock en gros) : on scanne ou on cherche chaque article, on saisit la
 * quantité comptée ; la validation (chef du comptoir, finance) compare au
 * stock théorique DU MOMENT, passe les écarts en stock et les chiffre au coût.
 */
export interface IDeskInventory {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  number: string;
  level: "desk" | "reserve";
  status: "open" | "validated" | "cancelled";
  category?: string;
  /**
   * `parts` : un sous-total par appareil (deux magasiniers comptent le même
   * article à deux endroits, leurs comptages s'additionnent) ; `counted` en est
   * la somme. `expectedAtCount` : stock théorique au PREMIER comptage de
   * l'article, base de l'écart (une vente faite ensuite ne crée pas d'écart).
   */
  lines: Array<{ itemId: Types.ObjectId; name: string; unit: string; barcode?: string; packSize?: number; parts?: Array<{ device: string; qty: number; at: Date; by: Types.ObjectId }>; counted?: number; countedAt?: Date; countedBy?: Types.ObjectId; expectedAtCount?: number; expected?: number; gap?: number; unitCost?: number; gapValue?: number }>;
  note?: string;
  startedBy: Types.ObjectId;
  validatedBy?: Types.ObjectId;
  validatedAt?: Date;
  /** Écart net chiffré au coût (négatif = manquant). */
  gapValue?: number;
  createdAt: Date;
  updatedAt: Date;
}

const DeskInventorySchema = new Schema<IDeskInventory>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  number: { type: String, required: true, maxlength: 40 },
  level: { type: String, enum: ["desk", "reserve"], required: true },
  status: { type: String, enum: ["open", "validated", "cancelled"], default: "open" },
  category: { type: String, maxlength: 60 },
  lines: [{
    _id: false,
    itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true },
    name: { type: String, required: true }, unit: String, barcode: String, packSize: Number,
    parts: [{ _id: false, device: { type: String, maxlength: 64 }, qty: { type: Number, min: 0 }, at: Date, by: { type: Schema.Types.ObjectId, ref: "User" } }],
    counted: { type: Number, min: 0 }, countedAt: Date, countedBy: { type: Schema.Types.ObjectId, ref: "User" },
    expectedAtCount: Number, expected: Number, gap: Number, unitCost: Number, gapValue: Number,
  }],
  note: { type: String, maxlength: 400 },
  startedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  validatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  validatedAt: Date,
  gapValue: Number,
}, { timestamps: true });

DeskInventorySchema.index({ tenantId: 1, deskId: 1, createdAt: -1 });
DeskInventorySchema.index({ tenantId: 1, deskId: 1, level: 1, status: 1 });
// Un seul inventaire ouvert par niveau et par comptoir, même ouvert deux fois en même temps.
DeskInventorySchema.index({ tenantId: 1, deskId: 1, level: 1 }, { unique: true, partialFilterExpression: { status: "open" } });
DeskInventorySchema.index({ tenantId: 1, deskId: 1, number: 1 }, { unique: true });

export const DeskInventoryModel = models.DeskInventory || model<IDeskInventory>("DeskInventory", DeskInventorySchema);
