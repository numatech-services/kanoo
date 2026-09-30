import { Schema, model, models } from "mongoose";
import { IAccountingEntry } from "@/types";
import { BusinessRuleError } from "@/lib/errors";

const AccountingLineSchema = new Schema(
  {
    accountCode: { type: String, required: true },
    accountLabel: { type: String, required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    thirdPartyId: { type: Schema.Types.ObjectId },
    // Imputation analytique : à quel projet, secteur d'activité et service la
    // charge (ou le produit) se rattache. Coût des projets et rentabilité par
    // secteur se calculent à partir de ces lignes.
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
    activityId: { type: Schema.Types.ObjectId, ref: "Activity" },
    costCenter: { type: String, maxlength: 20 },
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
      enum: ["invoice", "payment", "supplier_invoice", "supplier_payment", "payslip", "expense", "credit_note",
        "recurringExpense", "delivery", "stock", "inventory", "fixed_asset", "treasury", "reversal", "closing", "manual", "withholding"],
    },
    /** Extourne : l'écriture qui annule celle-ci, et inversement. */
    reversedBy: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
    reverses: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
    linkedDocId: Schema.Types.ObjectId,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

AccountingEntrySchema.index({ tenantId: 1, entryDate: 1 });
AccountingEntrySchema.index({ tenantId: 1, journalCode: 1 });
AccountingEntrySchema.index({ tenantId: 1, linkedDocId: 1 });
AccountingEntrySchema.index({ tenantId: 1, "lines.projectId": 1 });
AccountingEntrySchema.index({ tenantId: 1, "lines.accountCode": 1 });

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

/**
 * Période clôturée : aucune écriture datée d'une période verrouillée ne peut
 * être créée ni modifiée (les corrections passent par une écriture datée de
 * la période ouverte). Le verrou est porté par l'organisation.
 */
AccountingEntrySchema.pre("save", async function () {
  if (!this.isNew && !this.isModified("entryDate") && !this.isModified("lines")) return;
  const Tenant = models.Tenant;
  if (!Tenant) return;
  const t = await Tenant.findById(this.tenantId).select("accountingLockedUntil").lean<{ accountingLockedUntil?: Date } | null>();
  if (t?.accountingLockedUntil && new Date(this.entryDate) <= new Date(t.accountingLockedUntil)) {
    throw new BusinessRuleError(
      `Période comptable clôturée jusqu'au ${new Date(t.accountingLockedUntil).toLocaleDateString("fr-FR")} : datez l'opération dans la période ouverte.`
    );
  }
});

export const AccountingEntryModel =
  models.AccountingEntry || model<IAccountingEntry>("AccountingEntry", AccountingEntrySchema);
