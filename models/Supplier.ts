import { Schema, model, models } from "mongoose";
import { ISupplier } from "@/types";
const SupplierSchema = new Schema<ISupplier>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, code: { type: String, required: true }, name: { type: String, required: true, trim: true }, nif: String, email: String, phone: String, address: String, paymentTermDays: { type: Number, default: 30 }, bankName: String, bankAccount: String, isActive: { type: Boolean, default: true } }, { timestamps: true });
SupplierSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const SupplierModel = models.Supplier || model<ISupplier>("Supplier", SupplierSchema);
