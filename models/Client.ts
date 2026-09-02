import { Schema, model, models } from "mongoose";
import { IClient } from "@/types";
const ClientSchema = new Schema<IClient>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, code: { type: String, required: true }, name: { type: String, required: true, trim: true }, type: { type: String, enum: ["individual", "company"], default: "company" }, nif: String, rccm: String, email: String, phone: String, address: String, creditLimit: { type: Number, default: 0 }, currentBalance: { type: Number, default: 0 }, paymentTermDays: { type: Number, default: 30 }, isActive: { type: Boolean, default: true }, notes: String }, { timestamps: true });
ClientSchema.index({ tenantId: 1, code: 1 }, { unique: true });
ClientSchema.index({ tenantId: 1, name: 1 });
export const ClientModel = models.Client || model<IClient>("Client", ClientSchema);
