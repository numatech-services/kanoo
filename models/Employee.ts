import { Schema, model, models } from "mongoose";

const EmployeeSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  code: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: String,
  phone: String,
  nif: String,
  cnssNumber: String,
  bankAccount: String,
  bankName: String,

  // Type de collaborateur
  employeeType: { type: String, enum: ["employee","intern","freelance"], default: "employee" },
  contractNature: { type: String, enum: ["cdi","cdd","stage","freelance","consultant"], default: "cdi" },

  position: { type: String, required: true },
  department: String,

  // Rémunération
  grossSalary: { type: Number, default: 0 },
  indemnity: { type: Number, default: 0 },
  indemnityPeriod: { type: String, enum: ["monthly","daily","hourly","fixed"], default: "monthly" },

  // Dates
  startDate: { type: Date, required: true },
  endDate: Date,
  contractEndDate: Date,

  // Paramètres paie
  includeCnss: { type: Boolean, default: true },
  includeIr: { type: Boolean, default: true },
  otherDeductionLabel: String,
  otherDeductionAmount: { type: Number, default: 0 },

  // Trésorerie
  paymentTreasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },

  isActive: { type: Boolean, default: true },
  notes: String,
}, { timestamps: true });

EmployeeSchema.index({ tenantId: 1, code: 1 }, { unique: true });
EmployeeSchema.index({ tenantId: 1, isActive: 1 });
EmployeeSchema.index({ tenantId: 1, contractEndDate: 1 });

export const EmployeeModel = models.Employee || model("Employee", EmployeeSchema);
