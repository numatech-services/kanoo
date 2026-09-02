import { Schema, model, models } from "mongoose";
const TreasuryAccountSchema = new Schema({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, type: { type: String, enum: ["bank","cash","mobile_money"], required: true }, label: { type: String, required: true }, accountNumber: String, balance: { type: Number, default: 0 }, currency: { type: String, default: "XOF" }, isActive: { type: Boolean, default: true } }, { timestamps: true });
export const TreasuryAccountModel = models.TreasuryAccount || model("TreasuryAccount", TreasuryAccountSchema);
