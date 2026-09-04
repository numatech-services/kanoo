import { Schema, model, models } from "mongoose";
import { IPublicTender } from "@/types";

/** Une soumission reçue lors du dépouillement des plis. */
const BidSchema = new Schema({
  bidderName: { type: String, required: true, trim: true },
  supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
  amount: { type: Number, required: true, min: 0 },
  compliant: { type: Boolean, default: true },
  notes: String,
}, { _id: true });

const TenderSchema = new Schema<IPublicTender>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, reference: { type: String, required: true }, object: { type: String, required: true }, budgetChapterId: { type: Schema.Types.ObjectId, ref: "BudgetChapter" }, estimatedAmount: { type: Number, required: true }, procedure: { type: String, enum: ["achat_direct","consultation_restreinte","appel_offres_ouvert","appel_offres_international","gre_a_gre"], required: true }, status: { type: String, enum: ["planning","draft","published","bids_open","bids_closed","evaluation","attributed","cancelled","completed"], default: "planning" }, publishDate: Date, bidsDeadline: Date, openingDate: Date, attributionDate: Date,
  /** Titulaire : nom en clair (obligatoire à l'attribution) + lien fournisseur optionnel. */
  winnerName: String, winnerId: { type: Schema.Types.ObjectId, ref: "Supplier" }, winnerAmount: Number,
  bids: { type: [BidSchema], default: [] },
  commissionMemberIds: [Schema.Types.ObjectId],
  cancelReason: String,
  /** Engagement budgétaire créé à partir de l'attribution. */
  engagementId: { type: Schema.Types.ObjectId, ref: "Engagement" },
  notes: String }, { timestamps: true });
TenderSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
TenderSchema.index({ tenantId: 1, status: 1 });
export const PublicTenderModel = models.PublicTender || model<IPublicTender>("PublicTender", TenderSchema);
