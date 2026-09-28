import { Schema, model, models, Types } from "mongoose";

/**
 * Secteur / activité de l'entreprise (Vente mobilier, ISIC, Abonnements,
 * Marchés publics, Prestations…). Sert de dimension analytique : on rattache
 * recettes et dépenses à un secteur pour mesurer sa rentabilité.
 */
export interface IActivity {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  color?: string;
  archived: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActivitySchema = new Schema<IActivity>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  color: String,
  archived: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ActivitySchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const ActivityModel = models.Activity || model<IActivity>("Activity", ActivitySchema);
