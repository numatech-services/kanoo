import { Schema, model, models } from "mongoose";
import { IProduct } from "@/types";
const ProductSchema = new Schema<IProduct>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, code: { type: String, required: true }, label: { type: String, required: true }, description: String, unitPrice: { type: Number, required: true, min: 0 }, tvaRate: { type: Number, default: 0.19 }, unit: { type: String, default: "unité" }, stockQty: { type: Number, default: 0 }, stockMinAlert: { type: Number, default: 0 },
  // Gestion fine du stock
  /** Coût moyen unitaire pondéré (CMUP), mis à jour à chaque entrée valorisée. */
  purchaseCost: { type: Number, default: 0, min: 0 },
  /** Dernier prix d'achat constaté. */
  lastPurchaseCost: { type: Number, min: 0 },
  category: { type: String, trim: true, maxlength: 80 },
  barcode: { type: String, trim: true, maxlength: 60 },
  /** Emplacement de rangement (magasin, rayon, étagère…). */
  location: { type: String, trim: true, maxlength: 80 },
  preferredSupplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
  /** Stock maximal souhaité : sert à proposer la quantité à commander. */
  stockMaxAlert: { type: Number, default: 0, min: 0 },
  isService: { type: Boolean, default: false }, accountCode: String, isActive: { type: Boolean, default: true } }, { timestamps: true });
ProductSchema.index({ tenantId: 1, code: 1 }, { unique: true });
ProductSchema.index({ tenantId: 1, category: 1 });
ProductSchema.index({ tenantId: 1, barcode: 1 }, { sparse: true });
export const ProductModel = models.Product || model<IProduct>("Product", ProductSchema);
