import { Schema, model, models, Types } from "mongoose";

/**
 * Écriture analytique : une recette ou une dépense rattachée à un secteur
 * (ou aux frais généraux quand `activityId` est absent). Alimente le tableau de
 * rentabilité par activité. Saisie manuelle (MVP) ; l'auto-alimentation depuis
 * les factures / lots ISIC pourra s'ajouter ensuite.
 */
export interface IAnalyticEntry {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  activityId?: Types.ObjectId;   // absent = frais généraux
  kind: "revenue" | "expense";
  label: string;
  amount: number;
  date: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AnalyticEntrySchema = new Schema<IAnalyticEntry>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  activityId: { type: Schema.Types.ObjectId, ref: "Activity", index: true },
  kind: { type: String, enum: ["revenue", "expense"], required: true },
  label: { type: String, required: true, trim: true, maxlength: 200 },
  amount: { type: Number, required: true, min: 0 },
  date: { type: Date, required: true, default: Date.now, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

AnalyticEntrySchema.index({ tenantId: 1, date: -1 });
AnalyticEntrySchema.index({ tenantId: 1, activityId: 1, kind: 1 });

export const AnalyticEntryModel = models.AnalyticEntry || model<IAnalyticEntry>("AnalyticEntry", AnalyticEntrySchema);
