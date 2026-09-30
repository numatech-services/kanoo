import { Schema, model, models, Types } from "mongoose";

/**
 * Comptoir / point d'activité (« The Spot » et tout autre point à venir).
 *
 * Une activité que l'on gère à part, avec sa propre **comptabilité matière**
 * (stock d'articles) et sa propre **caisse** (argent). Sa gestion peut être
 * confiée à un rôle dédié (« Gestionnaire d'activité ») en plus du comptable
 * principal, sans lui ouvrir toute la comptabilité de l'organisation.
 *
 * Rattaché facultativement à un secteur analytique (`activityId`) pour que ses
 * résultats remontent dans la rentabilité par secteur.
 */
export interface IActivityDesk {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  description?: string;
  /** Secteur analytique lié (rentabilité par secteur), s'il y a lieu. */
  activityId?: Types.ObjectId;
  warehouseId?: Types.ObjectId;
  archived: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActivityDeskSchema = new Schema<IActivityDesk>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, maxlength: 400 },
  activityId: { type: Schema.Types.ObjectId, ref: "Activity" },
  /** Réserve du comptoir dans la gestion de stock (créée automatiquement). */
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
  archived: { type: Boolean, default: false, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ActivityDeskSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const ActivityDeskModel = models.ActivityDesk || model<IActivityDesk>("ActivityDesk", ActivityDeskSchema);
