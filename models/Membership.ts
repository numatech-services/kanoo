import { Schema, model, models } from "mongoose";
import { IMembership } from "@/types";
const MembershipSchema = new Schema<IMembership>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true }, year: { type: Number, required: true }, amount: { type: Number, required: true }, paidAt: Date, paymentMethod: String, receiptNumber: { type: String, required: true } }, { timestamps: true });
MembershipSchema.index({ tenantId: 1, memberId: 1, year: 1 }, { unique: true });
export const MembershipModel = models.Membership || model<IMembership>("Membership", MembershipSchema);
