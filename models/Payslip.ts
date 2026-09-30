import { Schema, model, models } from "mongoose";
import { IPayslip } from "@/types";
const PayslipSchema = new Schema<IPayslip>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true }, month: { type: Number, required: true, min: 1, max: 12 }, year: { type: Number, required: true }, grossSalary: { type: Number, required: true },
  // Assiette réelle des cotisations : base + ancienneté + primes.
  grossTotal: { type: Number, required: true },
  seniorityRate: { type: Number, default: 0 },
  seniorityAmount: { type: Number, default: 0 },
  cnssEmployee: { type: Number, required: true },
  cnssEmployer: { type: Number, required: true },
  // L'IR n'était pas retenu du tout : la route de génération ignorait le moteur
  // de paie et recalculait un net sans impôt.
  incomeTax: { type: Number, default: 0 },
  otherDeductions: { type: Number, default: 0 },
  // Détail des primes et retenues du mois (libellé, montant, sens) — le bulletin
  // imprimé les liste une à une.
  items: [{ _id: false, label: { type: String, maxlength: 120 }, amount: Number, type: { type: String, enum: ["addition", "deduction"] } }],
  netImposable: { type: Number, default: 0 },
  /** Écriture OD de constatation de la paie (annulée par extourne si le bulletin est supprimé). */
  accountingEntryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  netSalary: { type: Number, required: true },
  employerCost: { type: Number, default: 0 },
  isPaid: { type: Boolean, default: false }, paidAt: Date }, { timestamps: true });
PayslipSchema.index({ tenantId: 1, employeeId: 1, year: 1, month: 1 }, { unique: true });
export const PayslipModel = models.Payslip || model<IPayslip>("Payslip", PayslipSchema);
