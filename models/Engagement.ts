import mongoose, { Schema, model, models } from "mongoose";

const EngagementSchema = new Schema({
  tenantId: { type: String, required: true, index: true },
  reference: { type: String, required: true, unique: true },
  chapterId: { type: Schema.Types.ObjectId, ref: "BudgetChapter", required: true },
  chapterCode: { type: String, required: true },
  description: { type: String, required: true },
  provider: { type: String, required: true }, // Bénéficiaire
  amount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ["en_attente", "approuve", "rejete", "mandate"], 
    default: "en_attente" 
  },
  notes: { type: String },
  createdBy: { type: String },
}, { timestamps: true });

export const EngagementModel = models.Engagement || model("Engagement", EngagementSchema);