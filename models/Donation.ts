import { Schema, model, models } from "mongoose";
import { IDonation } from "@/types";
const DonationSchema = new Schema<IDonation>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, donorName: String, donorType: { type: String, enum: ["individual","company","anonymous"], default: "anonymous" }, donorContact: String, amount: { type: Number, required: true }, currency: { type: String, enum: ["XOF","EUR","USD"], default: "XOF" }, campaign: String, date: { type: Date, required: true }, paymentMethod: String, receiptNumber: { type: String, required: true }, receiptGeneratedAt: Date, notes: String }, { timestamps: true });
DonationSchema.index({ tenantId: 1, date: -1 });
export const DonationModel = models.Donation || model<IDonation>("Donation", DonationSchema);
