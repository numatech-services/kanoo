import { Schema, model, models } from "mongoose";

/**
 * Promotion d'un comptoir (lib/spot) : remise ou prix imposé, sur des
 * articles ou une famille, certains jours, à certaines heures (happy hour),
 * à partir d'une quantité (prix de gros), entre deux dates.
 */
const DeskPromoSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  itemIds: [{ type: Schema.Types.ObjectId, ref: "ActivityItem" }],
  category: { type: String, trim: true, maxlength: 60 },
  kind: { type: String, enum: ["percent", "price"], required: true },
  value: { type: Number, required: true, min: 0 },
  days: [{ type: Number, min: 0, max: 6 }],
  from: { type: String, match: /^\d{2}:\d{2}$/ },
  to: { type: String, match: /^\d{2}:\d{2}$/ },
  minQty: { type: Number, min: 0 },
  startDate: Date,
  endDate: Date,
  active: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

DeskPromoSchema.index({ tenantId: 1, deskId: 1, active: 1 });

export const DeskPromoModel = models.DeskPromo || model("DeskPromo", DeskPromoSchema);
