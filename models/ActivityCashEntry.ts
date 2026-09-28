import { Schema, model, models, Types } from "mongoose";

/**
 * Écriture de caisse d'un comptoir (comptabilité argent) : un encaissement
 * (recette) ou un décaissement (dépense), avec moyen de paiement. Le solde de
 * caisse se calcule par différence. Une écriture peut être liée à un mouvement
 * de stock (une vente qui sort de l'article et entre en caisse).
 */
export interface IActivityCashEntry {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  direction: "in" | "out";
  amount: number;
  label: string;
  method: "cash" | "bank_transfer" | "orange_money" | "card" | "check" | "other";
  date: Date;
  linkedMoveId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActivityCashEntrySchema = new Schema<IActivityCashEntry>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true, index: true },
  direction: { type: String, enum: ["in", "out"], required: true },
  amount: { type: Number, required: true, min: 0 },
  label: { type: String, required: true, trim: true, maxlength: 200 },
  method: { type: String, enum: ["cash", "bank_transfer", "orange_money", "card", "check", "other"], default: "cash" },
  date: { type: Date, required: true, default: Date.now, index: true },
  linkedMoveId: { type: Schema.Types.ObjectId, ref: "ActivityStockMove" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ActivityCashEntrySchema.index({ tenantId: 1, deskId: 1, date: -1 });

export const ActivityCashEntryModel = models.ActivityCashEntry || model<IActivityCashEntry>("ActivityCashEntry", ActivityCashEntrySchema);
