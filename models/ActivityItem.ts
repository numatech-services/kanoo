import { Schema, model, models, Types } from "mongoose";

/**
 * Article d'un comptoir (comptabilité matière). Porte le stock courant, valorisé
 * au coût unitaire. Les entrées / sorties passent par ActivityStockMove, qui met
 * `quantity` à jour dans une transaction — jamais à la main.
 */
export interface IActivityItem {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  name: string;
  unit: string;
  sku?: string;
  /** Stock courant (mis à jour par les mouvements). */
  quantity: number;
  /** Coût unitaire (valorisation du stock). */
  unitCost: number;
  /** Prix de vente indicatif (pour la caisse). */
  salePrice?: number;
  /** Seuil d'alerte de réapprovisionnement. */
  threshold?: number;
  /** Article du catalogue : son stock est celui de la réserve du comptoir. */
  productId?: Types.ObjectId;
  /** Famille (boissons, biscuits, snacks…) pour les palmarès et la rentabilité. */
  category?: string;
  /**
   * Conditionnement d'achat : on achète un « paquet » de `size` unités au prix
   * `cost`, on revend à l'unité. Donne le coût de revient unitaire.
   */
  pack?: { label?: string; size?: number; cost?: number };
  archived: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActivityItemSchema = new Schema<IActivityItem>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  unit: { type: String, default: "unité", maxlength: 24 },
  sku: { type: String, maxlength: 60, trim: true },
  quantity: { type: Number, default: 0, min: 0 },
  unitCost: { type: Number, default: 0, min: 0 },
  salePrice: { type: Number, min: 0 },
  threshold: { type: Number, min: 0 },
  productId: { type: Schema.Types.ObjectId, ref: "Product", index: true },
  category: { type: String, trim: true, maxlength: 60 },
  pack: {
    label: { type: String, trim: true, maxlength: 30 },
    size: { type: Number, min: 1 },
    cost: { type: Number, min: 0 },
  },
  archived: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ActivityItemSchema.index({ tenantId: 1, deskId: 1, name: 1 });

export const ActivityItemModel = models.ActivityItem || model<IActivityItem>("ActivityItem", ActivityItemSchema);
