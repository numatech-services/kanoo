import { Schema, model, models } from "mongoose";
import { IGoodsReceipt } from "@/types";
const LineSchema = new Schema({ commandeLineIndex: Number, description: String, orderedQty: Number, receivedQty: Number, unitPrice: Number }, { _id: false });
const GRSchema = new Schema<IGoodsReceipt>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, number: { type: String, required: true }, commandeId: { type: Schema.Types.ObjectId, ref: "Commande", required: true }, supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true }, lines: [LineSchema], receiptDate: { type: Date, required: true }, notes: String, receivedBy: { type: Schema.Types.ObjectId, ref: "User", required: true } }, { timestamps: true });
GRSchema.index({ tenantId: 1, commandeId: 1 });
export const GoodsReceiptModel = models.GoodsReceipt || model<IGoodsReceipt>("GoodsReceipt", GRSchema);
