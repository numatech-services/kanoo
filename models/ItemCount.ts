import { Schema, model, models } from "mongoose";

/** Comptage d'un article du comptoir (inventaire tournant). */
const ItemCountSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true },
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  expected: { type: Number, required: true },
  counted: { type: Number, required: true, min: 0 },
  gap: { type: Number, required: true },
  /** Écart valorisé au coût (négatif : manquant). */
  gapValue: { type: Number, required: true },
  countedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ItemCountSchema.index({ tenantId: 1, deskId: 1, itemId: 1, day: -1 });

export const ItemCountModel = models.ItemCount || model("ItemCount", ItemCountSchema);
