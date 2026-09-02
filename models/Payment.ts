import { Schema, model, models } from "mongoose";
import { IPayment } from "@/types";
const PaymentSchema = new Schema<IPayment>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true }, amount: { type: Number, required: true, min: 0 }, method: { type: String, enum: ["cash","bank_transfer","cheque","mobile_money","other"], required: true }, reference: String, date: { type: Date, required: true }, notes: String, createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true } }, { timestamps: true });
PaymentSchema.index({ tenantId: 1, invoiceId: 1 });
export const PaymentModel = models.Payment || model<IPayment>("Payment", PaymentSchema);
