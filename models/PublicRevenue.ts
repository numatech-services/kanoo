// models/PublicRevenue.ts
import { Schema, model, models } from "mongoose";

export interface IPublicRevenue {
  tenantId: Schema.Types.ObjectId;
  reference: string;           // ex: Q-2026-0001 (Numéro de Quittance)
  budgetChapterId: Schema.Types.ObjectId; // Lien vers le chapitre de RECETTE
  serviceId?: Schema.Types.ObjectId;      // Optionnel: lien vers un "Product" (Service)
  payerName: string;           // Nom du citoyen ou de l'entreprise
  payerNIF?: string;           // NIF ou CNSS si applicable
  amount: number;
  type: "taxe" | "service" | "droit_timbre" | "location" | "amende" | "autre";
  paymentMethod: "cash" | "orange_money" | "moov_money" | "transfer" | "cheque";
  status: "pending" | "collected" | "cancelled";
  collectedBy: Schema.Types.ObjectId; // L'utilisateur qui a encaissé
  date: Date;
  notes?: string;
}

const PublicRevenueSchema = new Schema<IPublicRevenue>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    reference: { type: String, required: true, unique: true },
    budgetChapterId: { type: Schema.Types.ObjectId, ref: "BudgetChapter", required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: "Product" },
    payerName: { type: String, required: true },
    payerNIF: { type: String },
    amount: { type: Number, required: true, min: 0 },
    type: { 
      type: String, 
      enum: ["taxe", "service", "droit_timbre", "location", "amende", "autre"], 
      required: true 
    },
    paymentMethod: { 
      type: String, 
      enum: ["cash", "orange_money", "moov_money", "transfer", "cheque"], 
      default: "cash" 
    },
    status: { 
      type: String, 
      enum: ["pending", "collected", "cancelled"], 
      default: "collected" 
    },
    collectedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: Date, default: Date.now },
    notes: { type: String },
  },
  { timestamps: true }
);

// Index pour accélérer les recherches par date et par type
PublicRevenueSchema.index({ tenantId: 1, date: -1 });
PublicRevenueSchema.index({ reference: "text", payerName: "text" });

export const PublicRevenueModel =
  models.PublicRevenue || model<IPublicRevenue>("PublicRevenue", PublicRevenueSchema);