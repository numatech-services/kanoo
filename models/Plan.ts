import mongoose, { Schema, model, models } from "mongoose";

const PlanSchema = new Schema({
  code: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  targetType: { type: String, enum: ['pme', 'association', 'administration'] },
  priceMonthly: { type: Number, default: 0 },
  maxUsers: { type: Number, default: 1 },
  features: [String],
  highlighted: { type: Boolean, default: false },
}, { timestamps: true });

export const Plan = models.Plan || model("Plan", PlanSchema);