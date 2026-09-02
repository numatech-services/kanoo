import { Schema, model, models } from "mongoose";

export type DealStage =
  | "prospect"        // Prospect identifié
  | "contacted"       // Premier contact
  | "qualified"       // Qualifié (budget + besoin confirmés)
  | "proposal"        // Devis envoyé
  | "negotiation"     // En négociation
  | "won"             // Gagné
  | "lost";           // Perdu

const DealSchema = new Schema({
  tenantId:   { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  title:      { type: String, required: true },
  clientId:   { type: Schema.Types.ObjectId, ref: "Client" },
  contactName:  String,
  contactPhone: String,
  contactEmail: String,
  amount:     { type: Number, default: 0 },
  currency:   { type: String, default: "XOF" },
  stage:      { type: String, enum: ["prospect","contacted","qualified","proposal","negotiation","won","lost"], default: "prospect" },
  probability:{ type: Number, default: 20 },   // % de chance de conversion
  expectedCloseDate: Date,
  closedAt:   Date,
  lostReason: String,
  ownerId:    { type: Schema.Types.ObjectId, ref: "User" },
  tags:       [String],
  notes:      String,
  // Liens
  devisId:    { type: Schema.Types.ObjectId, ref: "Devis" },
  invoiceId:  { type: Schema.Types.ObjectId, ref: "Invoice" },
  // Relances planifiées
  nextFollowUpAt: Date,
  followUpCount:  { type: Number, default: 0 },
  lastActivityAt: Date,
}, { timestamps: true });

DealSchema.index({ tenantId: 1, stage: 1 });
DealSchema.index({ tenantId: 1, nextFollowUpAt: 1 });

export const CRMDealModel = models.CRMDeal || model("CRMDeal", DealSchema);
