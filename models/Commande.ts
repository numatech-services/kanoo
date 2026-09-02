import { Schema, model, models } from "mongoose";
import { ICommande } from "@/types";
const LineSchema = new Schema({ description: String, quantity: Number, unitPrice: Number, tvaRate: Number, totalHT: Number, totalTVA: Number, totalTTC: Number }, { _id: false });
const CommandeSchema = new Schema<ICommande>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, number: { type: String, required: true }, supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true }, lines: [LineSchema], totalHT: Number, totalTVA: Number, totalTTC: Number, status: { type: String, enum: ["draft","confirmed","partially_received","received","cancelled","invoiced"], default: "draft" }, orderDate: { type: Date, required: true }, expectedDeliveryDate: Date, notes: String, approvedBy: Schema.Types.ObjectId, approvedAt: Date, createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true } }, { timestamps: true });
CommandeSchema.index({ tenantId: 1, number: 1 }, { unique: true });
export const CommandeModel = models.Commande || model<ICommande>("Commande", CommandeSchema);
