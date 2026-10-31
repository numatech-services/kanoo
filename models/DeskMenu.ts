import { Schema, model, models, Types } from "mongoose";

/**
 * Menu d'un service (midi, soir ou journée) d'un restaurant : les plats et
 * les quantités à produire. Base du bon de sortie de la réserve et du bilan
 * de fin de service (produit, vendu, restes).
 */
export interface IDeskMenu {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  day: string;
  service: "midi" | "soir" | "jour";
  lines: Array<{ itemId: Types.ObjectId; quantity: number }>;
  note?: string;
  /** Bon de sortie de la réserve passé pour ce menu. */
  issuedRef?: string;
  /** Fin de service : produit, vendu, restes (passés en perte « invendus »). */
  closing?: { at: Date; by: Types.ObjectId; lines: Array<{ itemId: Types.ObjectId; produced: number; sold: number; leftover: number; leftoverValue?: number }> };
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DeskMenuSchema = new Schema<IDeskMenu>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  service: { type: String, enum: ["midi", "soir", "jour"], required: true },
  lines: [{ _id: false, itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true }, quantity: { type: Number, required: true, min: 0 } }],
  note: { type: String, maxlength: 400 },
  issuedRef: { type: String, maxlength: 60 },
  // Sous-document facultatif, sans valeur par défaut : un menu n'est clos que s'il porte une clôture datée.
  closing: {
    type: new Schema({
      at: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, ref: "User" },
      lines: [{ _id: false, itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem" }, produced: Number, sold: Number, leftover: Number, leftoverValue: Number }],
    }, { _id: false }),
    default: undefined,
  },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

DeskMenuSchema.index({ tenantId: 1, deskId: 1, day: 1, service: 1 }, { unique: true });

export const DeskMenuModel = models.DeskMenu || model<IDeskMenu>("DeskMenu", DeskMenuSchema);
