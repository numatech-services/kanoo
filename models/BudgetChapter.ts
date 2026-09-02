import { Schema, model, models } from "mongoose";
import { IBudgetChapter } from "@/types";

const BudgetChapterSchema = new Schema<IBudgetChapter>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    code: { type: String, required: true },
    label: { type: String, required: true },
    year: { type: Number, required: true },
    allocatedAmount: { type: Number, default: 0 },
    engagedAmount: { type: Number, default: 0 },
    mandatedAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    parentId: { type: Schema.Types.ObjectId, ref: "BudgetChapter" },
    level: {
      type: String,
      enum: ["titre", "chapitre", "article", "ligne"],
      required: true,
    },
  },
  { timestamps: true }
);

BudgetChapterSchema.index({ tenantId: 1, year: 1, code: 1 }, { unique: true });

/** Vérifie qu'un engagement est possible (crédit disponible) */
BudgetChapterSchema.methods.hasAvailableCredit = function (amount: number): boolean {
  const available = this.allocatedAmount - this.engagedAmount;
  return available >= amount;
};

/** Ajoute un engagement budgétaire */
BudgetChapterSchema.methods.engage = async function (amount: number): Promise<void> {
  if (!this.hasAvailableCredit(amount)) {
    throw new Error(
      `Crédit insuffisant sur le chapitre ${this.code}. Disponible : ${this.allocatedAmount - this.engagedAmount} XOF, demandé : ${amount} XOF`
    );
  }
  this.engagedAmount += amount;
  await this.save();
};

export const BudgetChapterModel =
  models.BudgetChapter || model<IBudgetChapter>("BudgetChapter", BudgetChapterSchema);
