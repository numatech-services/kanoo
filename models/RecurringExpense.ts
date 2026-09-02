import { Schema, model, models } from "mongoose";

export type ExpenseFrequency = "daily" | "weekly" | "monthly" | "quarterly" | "annual";
export type ExpenseCategory =
  | "loyer" | "electricite" | "eau" | "internet" | "telephone"
  | "assurance" | "abonnement" | "salaire" | "prestation"
  | "maintenance" | "fourniture" | "transport" | "autre";

const ExpenseExecutionSchema = new Schema({
  executedAt: { type: Date, required: true },
  amount: { type: Number, required: true },
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
  reference: String,
  notes: String,
}, { _id: true });

const RecurringExpenseSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

  // Identification
  label: { type: String, required: true },
  category: {
    type: String,
    enum: ["loyer", "electricite", "eau", "internet", "telephone", "assurance",
           "abonnement", "salaire", "prestation", "maintenance", "fourniture", "transport", "autre"],
    default: "autre",
  },
  description: String,

  // Financier
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: "XOF" },
  tvaRate: { type: Number, default: 0 },
  accountCode: { type: String, default: "622000" }, // Compte comptable OHADA

  // Fréquence
  frequency: {
    type: String,
    enum: ["daily", "weekly", "monthly", "quarterly", "annual"],
    default: "monthly",
  },
  startDate: { type: Date, required: true },
  endDate: Date, // null = indéfini

  // Prélèvement
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
  supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
  autoDeduct: { type: Boolean, default: false }, // Déduction auto trésorerie

  // Prochaine échéance
  nextDueDate: { type: Date, required: true },
  alertDaysBefore: { type: Number, default: 5 },

  // État
  isActive: { type: Boolean, default: true },
  executions: [ExpenseExecutionSchema], // Historique des exécutions

  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

RecurringExpenseSchema.index({ tenantId: 1, isActive: 1, nextDueDate: 1 });
RecurringExpenseSchema.index({ tenantId: 1, category: 1 });

export const RecurringExpenseModel = models.RecurringExpense || model("RecurringExpense", RecurringExpenseSchema);
