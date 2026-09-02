import { Schema, model, models } from "mongoose";
import { IProduct } from "@/types";
const ProductSchema = new Schema<IProduct>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, code: { type: String, required: true }, label: { type: String, required: true }, description: String, unitPrice: { type: Number, required: true, min: 0 }, tvaRate: { type: Number, default: 0.19 }, unit: { type: String, default: "unité" }, stockQty: { type: Number, default: 0 }, stockMinAlert: { type: Number, default: 0 }, isService: { type: Boolean, default: false }, accountCode: String, isActive: { type: Boolean, default: true } }, { timestamps: true });
ProductSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const ProductModel = models.Product || model<IProduct>("Product", ProductSchema);
