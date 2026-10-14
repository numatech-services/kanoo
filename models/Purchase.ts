import { Schema, model, models } from "mongoose";

/**
 * Achat : facture fournisseur ou dépense payée au comptant.
 *
 * Cycle : brouillon → validé (écriture AC : charges 6xx imputées, TVA
 * récupérable, dette fournisseur 401) → réglé partiellement / soldé (écritures
 * BQ/CA 401 → trésorerie + mouvement) ; annulé par extourne tant qu'aucun
 * règlement n'est enregistré. Chaque ligne porte son imputation analytique
 * (projet, secteur d'activité, service) : c'est elle qui alimente le coût des
 * projets et la rentabilité par secteur.
 */
const LineSchema = new Schema({
  description: { type: String, required: true, trim: true, maxlength: 300 },
  accountCode: { type: String, required: true, trim: true, maxlength: 12 },
  accountLabel: { type: String, trim: true, maxlength: 120 },
  quantity: { type: Number, default: 1, min: 0 },
  unitPrice: { type: Number, default: 0, min: 0 },
  amountHT: { type: Number, required: true, min: 0 },
  tvaRate: { type: Number, default: 0, min: 0, max: 0.99 },
  amountTVA: { type: Number, default: 0, min: 0 },
  projectId: { type: Schema.Types.ObjectId, ref: "Project" },
  activityId: { type: Schema.Types.ObjectId, ref: "Activity" },
  costCenter: { type: String, maxlength: 20 },
}, { _id: false });

const PaymentSchema = new Schema({
  date: { type: Date, required: true },
  amount: { type: Number, required: true, min: 1 },
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount", required: true },
  reference: { type: String, trim: true, maxlength: 80 },
  entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  movementId: { type: Schema.Types.ObjectId, ref: "TreasuryMovement" },
  cancelledAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
});

const PurchaseSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  number: { type: String, required: true },
  /** invoice : facture fournisseur (à payer) ; cash : dépense payée sur le champ. */
  kind: { type: String, enum: ["invoice", "cash"], default: "invoice" },
  supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
  /** Bénéficiaire libre d'une dépense sans fiche fournisseur (taxi, marché…). */
  payee: { type: String, trim: true, maxlength: 160 },
  /** Numéro de la facture chez le fournisseur. */
  supplierRef: { type: String, trim: true, maxlength: 80 },
  date: { type: Date, required: true },
  dueDate: Date,
  commandeId: { type: Schema.Types.ObjectId, ref: "Commande" },
  lines: { type: [LineSchema], validate: [(v: unknown[]) => v.length > 0, "Au moins une ligne"] },
  totalHT: { type: Number, required: true, min: 0 },
  totalTVA: { type: Number, default: 0, min: 0 },
  totalTTC: { type: Number, required: true, min: 0 },
  paidAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ["draft", "validated", "partial", "paid", "cancelled"], default: "draft", index: true },
  entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  payments: [PaymentSchema],
  notes: { type: String, maxlength: 2000 },
  /** Validation malgré une facture supérieure à la réception (rapprochement). */
  matchOverride: { by: { type: Schema.Types.ObjectId, ref: "User" }, at: Date, gapHT: Number },
  validatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  validatedAt: Date,
  cancelledAt: Date,
  cancelReason: { type: String, maxlength: 300 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

PurchaseSchema.index({ tenantId: 1, number: 1 }, { unique: true });
PurchaseSchema.index({ tenantId: 1, supplierId: 1, date: -1 });
PurchaseSchema.index({ tenantId: 1, "lines.projectId": 1 });
PurchaseSchema.index({ tenantId: 1, status: 1, dueDate: 1 });

export const PurchaseModel = models.Purchase || model("Purchase", PurchaseSchema);
