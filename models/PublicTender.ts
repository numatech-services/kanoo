import { Schema, model, models } from "mongoose";
import { IPublicTender } from "@/types";
const TenderSchema = new Schema<IPublicTender>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, reference: { type: String, required: true }, object: { type: String, required: true }, budgetChapterId: Schema.Types.ObjectId, estimatedAmount: { type: Number, required: true }, procedure: { type: String, enum: ["achat_direct","consultation_restreinte","appel_offres_ouvert","appel_offres_international","gre_a_gre"], required: true }, status: { type: String, enum: ["planning","draft","published","bids_open","bids_closed","evaluation","attributed","cancelled","completed"], default: "planning" }, publishDate: Date, bidsDeadline: Date, openingDate: Date, attributionDate: Date, winnerId: Schema.Types.ObjectId, winnerAmount: Number, commissionMemberIds: [Schema.Types.ObjectId], notes: String }, { timestamps: true });
TenderSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
TenderSchema.index({ tenantId: 1, status: 1 });
export const PublicTenderModel = models.PublicTender || model<IPublicTender>("PublicTender", TenderSchema);
