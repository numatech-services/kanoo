import { Schema, model, models, Types } from "mongoose";

export type ContractType = "client" | "supplier" | "employment" | "freelance" | "other";
export type ContractStatus = "draft" | "active" | "suspended" | "expired" | "cancelled" | "renewed";
export type PaymentMode = "virement" | "cheque" | "tresor_public" | "tresor_prive" | "especes" | "mobile_money" | "autre";
export type BillingFrequency = "one_time" | "monthly" | "quarterly" | "biannual" | "annual";

const MilestoneSchema = new Schema({
  label: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  dueDate: Date,
  invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
  status: { type: String, enum: ["pending", "invoiced", "paid"], default: "pending" },
}, { _id: true });

const ContractSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

  // Identification
  reference: { type: String, trim: true },
  title: { type: String, required: true, trim: true },
  type: { type: String, enum: ["client", "supplier", "employment", "freelance", "other"], required: true },
  status: { type: String, enum: ["draft", "active", "suspended", "expired", "cancelled", "renewed"], default: "draft" },

  // Parties liées
  clientId: { type: Schema.Types.ObjectId, ref: "Client" },
  supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
  employeeId: { type: Schema.Types.ObjectId, ref: "Employee" },

  // Financier
  amount: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: "XOF" },
  paymentMode: {
    type: String,
    enum: ["virement", "cheque", "tresor_public", "tresor_prive", "especes", "mobile_money", "autre"],
    default: "virement",
  },

  // Récurrence
  isRecurring: { type: Boolean, default: false },
  billingFrequency: {
    type: String,
    enum: ["one_time", "monthly", "quarterly", "biannual", "annual"],
    default: "one_time",
  },
  autoGenerateInvoice: { type: Boolean, default: false },
  nextBillingDate: Date,
  lastBilledDate: Date,

  // Dates
  startDate: Date,
  endDate: Date,
  signedDate: Date,
  renewalReminderDays: { type: Number, default: 30 },

  // Factures liées
  invoiceIds: [{ type: Schema.Types.ObjectId, ref: "Invoice" }],
  milestones: [MilestoneSchema],

  // Documents
  documentIds: [{ type: Schema.Types.ObjectId, ref: "Document" }],

  // Méta
  description: String,
  notes: String,
  tags: [String],

  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

ContractSchema.index({ tenantId: 1, status: 1 });
ContractSchema.index({ tenantId: 1, clientId: 1 });
ContractSchema.index({ tenantId: 1, isRecurring: 1, nextBillingDate: 1 });

// Génération de la référence automatique
ContractSchema.pre("save", async function (next) {
  if (!this.reference) {
    const year = new Date().getFullYear();
    const count = await (this.constructor as typeof ContractModel).countDocuments({ tenantId: this.tenantId });
    this.reference = `CTR-${year}-${String(count + 1).padStart(4, "0")}`;
  }
  next();
});

export const ContractModel = models.Contract || model("Contract", ContractSchema);
