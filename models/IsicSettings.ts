import { Schema, model, models, Types } from "mongoose";

/**
 * Réglages ISIC de l'organisation.
 * `renewalRequestType` : code « Request Type » attendu par ISIC pour un
 * renouvellement (étudiant qui garde son numéro). Non deviné : tant qu'il est
 * vide, l'export des renouvellements est refusé avec un message explicite.
 */
export interface IIsicSettings {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  renewalRequestType?: string;
  updatedBy?: Types.ObjectId;
}

const IsicSettingsSchema = new Schema<IIsicSettings>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true },
  renewalRequestType: { type: String, trim: true, uppercase: true, maxlength: 40 },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

export const IsicSettingsModel = models.IsicSettings || model<IIsicSettings>("IsicSettings", IsicSettingsSchema);
