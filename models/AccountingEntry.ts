import { Schema, model, models } from "mongoose";
import { IAccountingEntry } from "@/types";

const AccountingLineSchema = new Schema(
  {
    accountCode: { type: String, required: true },
    accountLabel: { type: String, required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    thirdPartyId: { type: Schema.Types.ObjectId },
  },
  { _id: false }
);

const AccountingEntrySchema = new Schema<IAccountingEntry>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    journalCode: {
      type: String,
      enum: ["AC", "VT", "BQ", "CA", "OD", "AN", "EX"],
      required: true,
    },
    entryDate: { type: Date, required: true },
    reference: { type: String, required: true },
    label: { type: String, required: true },
    lines: { type: [AccountingLineSchema], required: true },
    isLettered: { type: Boolean, default: false },
    letterRef: String,
    linkedDocType: {
      type: String,
      enum: ["invoice", "payment", "supplier_invoice", "payslip"],
    },
    linkedDocId: Schema.Types.ObjectId,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

AccountingEntrySchema.index({ tenantId: 1, entryDate: 1 });
AccountingEntrySchema.index({ tenantId: 1, journalCode: 1 });
AccountingEntrySchema.index({ tenantId: 1, linkedDocId: 1 });

/** Validation : une écriture doit être équilibrée (∑débits = ∑crédits) */
AccountingEntrySchema.pre("save", function (next) {
  const totalDebit = this.lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = this.lines.reduce((sum, l) => sum + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 1) {
    next(new Error(`Écriture déséquilibrée : débits=${totalDebit} ≠ crédits=${totalCredit}`));
  } else {
    next();
  }
});

export const AccountingEntryModel =
  models.AccountingEntry || model<IAccountingEntry>("AccountingEntry", AccountingEntrySchema);
