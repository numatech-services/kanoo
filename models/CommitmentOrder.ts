import { Schema, model, models } from "mongoose";
import { ICommitmentOrder } from "@/types";
const CommitmentSchema = new Schema<ICommitmentOrder>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, number: { type: String, required: true }, chapterId: { type: Schema.Types.ObjectId, ref: "BudgetChapter", required: true }, tenderId: Schema.Types.ObjectId, supplierId: Schema.Types.ObjectId, amount: { type: Number, required: true, min: 0 }, label: { type: String, required: true }, date: { type: Date, required: true }, validatedBy: Schema.Types.ObjectId, validatedAt: Date, status: { type: String, enum: ["draft","validated","rejected"], default: "draft" }, createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true } }, { timestamps: true });
CommitmentSchema.index({ tenantId: 1, number: 1 }, { unique: true });
export const CommitmentOrderModel = models.CommitmentOrder || model<ICommitmentOrder>("CommitmentOrder", CommitmentSchema);
