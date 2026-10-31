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
  /** Seuil d'alerte de la réserve (stock en gros du restaurant). */
  reserveThreshold?: number;
  /** Code-barres (EAN, UPC, code interne) : lu au scanner à l'inventaire et à la réception. */
  barcode?: string;
  /** Article du catalogue : son stock est celui de la réserve du comptoir. */
  productId?: Types.ObjectId;
  /** Famille (boissons, biscuits, snacks…) pour les palmarès et la rentabilité. */
  category?: string;
  /**
   * Conditionnement d'achat : on achète un « paquet » de `size` unités au prix
   * `cost`, on revend à l'unité. Donne le coût de revient unitaire.
   */
  pack?: { label?: string; size?: number; cost?: number };
  /** Objectif de taux de marque de l'article (0,30 = 30 % du prix HT) ; absent = celui du comptoir. */
  targetMarkup?: number;
  /**
   * Fiche recette d'une préparation (pastel maison, café, jus) : ingrédients
   * (autres articles du comptoir) et quantité par unité vendue. La vente sort
   * les ingrédients du stock ; le coût est leur somme.
   */
  recipe?: Array<{ itemId: Types.ObjectId; quantity: number }>;
  archived: boolean;
  /** Identifiant de l'article dans EasyPay (caisse reliée), pour relier les ventes reçues. */
  easypayId?: string;
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
  reserveThreshold: { type: Number, min: 0 },
  barcode: { type: String, trim: true, maxlength: 60 },
  productId: { type: Schema.Types.ObjectId, ref: "Product", index: true },
  category: { type: String, trim: true, maxlength: 60 },
  recipe: [{ _id: false, itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true }, quantity: { type: Number, required: true, min: 0 } }],
  pack: {
    label: { type: String, trim: true, maxlength: 30 },
    size: { type: Number, min: 1 },
    cost: { type: Number, min: 0 },
  },
  targetMarkup: { type: Number, min: 0, max: 0.95 },
  archived: { type: Boolean, default: false },
  easypayId: { type: String, maxlength: 64, trim: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ActivityItemSchema.index({ tenantId: 1, deskId: 1, name: 1 });
ActivityItemSchema.index({ tenantId: 1, deskId: 1, barcode: 1 }, { sparse: true });
ActivityItemSchema.index({ tenantId: 1, deskId: 1, easypayId: 1 }, { unique: true, partialFilterExpression: { easypayId: { $type: "string" } } });

export const ActivityItemModel = models.ActivityItem || model<IActivityItem>("ActivityItem", ActivityItemSchema);
