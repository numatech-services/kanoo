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
  /** Caisse de trésorerie qui reçoit les ventes ; sans elle, la caisse reste hors comptabilité. */
  treasuryAccountId?: Types.ObjectId;
  /** Produit des ventes (701100 marchandises, 706300 restauration…). */
  revenueAccount?: string;
  /** Charge des dépenses de caisse (601100 achats de marchandises…). */
  expenseAccount?: string;
  /** TVA comprise dans les prix (0 = non assujetti). */
  vatRate?: number;
  targetMarkup?: number;
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
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
  revenueAccount: { type: String, default: "701100", match: /^7\d{2,7}$/ },
  expenseAccount: { type: String, default: "601100", match: /^6\d{2,7}$/ },
  vatRate: { type: Number, default: 0, min: 0, max: 0.5 },
  /** Taux de marque visé (part du prix HT), pour le prix conseillé et les alertes. */
  targetMarkup: { type: Number, default: 0.3, min: 0, max: 0.95 },
  archived: { type: Boolean, default: false, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ActivityDeskSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const ActivityDeskModel = models.ActivityDesk || model<IActivityDesk>("ActivityDesk", ActivityDeskSchema);
