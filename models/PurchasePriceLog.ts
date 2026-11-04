import { Schema, model, models, Types } from "mongoose";

/**
 * Prix d'achat constatés à l'entrée en stock d'un restaurant (réception en
 * réserve, commande fournisseur reçue) : historique des prix, comparaison des
 * fournisseurs, et rapprochement réception ↔ facture pour le comptable.
 */
export interface IPurchasePriceLog {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  itemId: Types.ObjectId;
  supplierId?: Types.ObjectId;
  supplierName?: string;
  /** Coût unitaire payé, par unité de base (0 = réception non valorisée). */
  unitCost: number;
  quantity: number;
  date: Date;
  source: "reception" | "commande";
  reference?: string;
  commandeId?: Types.ObjectId;
  paidFromCash: boolean;
  /** Dette créée par cette réception (facture validée au 401). */
  purchaseId?: Types.ObjectId;
  /** Facture du fournisseur rapprochée (numéro), qui et quand. */
  invoiceRef?: string;
  invoicedAt?: Date;
  invoicedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PurchasePriceLogSchema = new Schema<IPurchasePriceLog>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  itemId: { type: Schema.Types.ObjectId, ref: "ActivityItem", required: true },
  supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
  supplierName: { type: String, maxlength: 120 },
  unitCost: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 0 },
  date: { type: Date, required: true },
  source: { type: String, enum: ["reception", "commande"], required: true },
  reference: { type: String, maxlength: 60 },
  commandeId: { type: Schema.Types.ObjectId, ref: "Commande" },
  paidFromCash: { type: Boolean, default: false },
  purchaseId: { type: Schema.Types.ObjectId, ref: "Purchase" },
  invoiceRef: { type: String, maxlength: 60 },
  invoicedAt: Date,
  invoicedBy: { type: Schema.Types.ObjectId, ref: "User" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

PurchasePriceLogSchema.index({ tenantId: 1, deskId: 1, itemId: 1, date: -1 });
PurchasePriceLogSchema.index({ tenantId: 1, deskId: 1, source: 1, paidFromCash: 1, invoiceRef: 1 });

export const PurchasePriceLogModel = models.PurchasePriceLog || model<IPurchasePriceLog>("PurchasePriceLog", PurchasePriceLogSchema);
