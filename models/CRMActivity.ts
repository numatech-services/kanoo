import { Schema, model, models } from "mongoose";

const CRMActivitySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  dealId:   { type: Schema.Types.ObjectId, ref: "CRMDeal", required: true, index: true },
  type:     { type: String, enum: ["call","email","meeting","note","whatsapp","demo","follow_up"], required: true },
  title:    { type: String, required: true },
  notes:    String,
  doneAt:   { type: Date, default: Date.now },
  createdBy:{ type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

export const CRMActivityModel = models.CRMActivity || model("CRMActivity", CRMActivitySchema);
