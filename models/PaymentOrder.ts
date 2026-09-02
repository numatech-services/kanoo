import { Schema, model, models } from "mongoose";
import { IPaymentOrder } from "@/types";
const POSchema = new Schema<IPaymentOrder>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, number: { type: String, required: true }, commitmentId: { type: Schema.Types.ObjectId, ref: "CommitmentOrder", required: true }, amount: { type: Number, required: true }, beneficiaryId: { type: Schema.Types.ObjectId, required: true }, retenueSource: { type: Number, default: 0 }, date: { type: Date, required: true }, status: { type: String, enum: ["draft","ordered","paid","rejected"], default: "draft" }, paidAt: Date, createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true } }, { timestamps: true });
POSchema.index({ tenantId: 1, number: 1 }, { unique: true });
export const PaymentOrderModel = models.PaymentOrder || model<IPaymentOrder>("PaymentOrder", POSchema);
