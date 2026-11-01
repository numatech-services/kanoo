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
  packBarcode?: string;
  rhythm?: "week" | "fortnight" | "month";
  altBarcodes?: string[];
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
  recipe?: Array<{ itemId: Types.ObjectId; quantity: number; yield?: number }>;
  /**
   * Fiche technique : la recette est écrite pour `portions` portions (1 par
   * défaut) ; chaque ligne donne la quantité NETTE utilisée et son rendement
   * (`yield`, poids net ÷ poids brut : 0,8 = 20 % de perte à l'épluchage ou à la
   * découpe). Une portion vendue consomme quantité ÷ rendement ÷ portions.
   */
  portions?: number;
  /** Grammage servi par portion (g), allergènes, procédé : pour la cuisine et la fiche imprimée. */
  servingWeight?: number;
  allergens?: string[];
  procedure?: string;
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
  /** Code du carton (une lecture = un carton de pack.size unités). */
  packBarcode: { type: String, trim: true, maxlength: 60 },
  /** Rythme de l'article : comptage à l'inventaire du samedi et durée couverte par le réassort (semaine, deux semaines, mois). */
  rhythm: { type: String, enum: ["week", "fortnight", "month"] },
  /** Autres codes de l'unité (autre fournisseur, autre étiquette). */
  altBarcodes: { type: [{ type: String, trim: true, maxlength: 60 }], default: undefined },
  productId: { type: Schema.Types.ObjectId, ref: "Product", index: true },
  category: { type: String, trim: true, maxlength: 60 },
  recipe: [{ _id: false, itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true }, quantity: { type: Number, required: true, min: 0 }, yield: { type: Number, min: 0.05, max: 1 } }],
  portions: { type: Number, min: 1, max: 10_000 },
  servingWeight: { type: Number, min: 0 },
  allergens: [{ type: String, maxlength: 40 }],
  procedure: { type: String, maxlength: 4000 },
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
ActivityItemSchema.index({ tenantId: 1, deskId: 1, packBarcode: 1 }, { sparse: true });
ActivityItemSchema.index({ tenantId: 1, deskId: 1, altBarcodes: 1 }, { sparse: true });
ActivityItemSchema.index({ tenantId: 1, deskId: 1, easypayId: 1 }, { unique: true, partialFilterExpression: { easypayId: { $type: "string" } } });

export const ActivityItemModel = models.ActivityItem || model<IActivityItem>("ActivityItem", ActivityItemSchema);
