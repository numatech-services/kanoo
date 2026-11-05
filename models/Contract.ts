import { Schema, model, models } from "mongoose";

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
  /** Échéance d'acompte (avance) ou de facturation ordinaire. */
  kind: { type: String, enum: ["deposit", "standard"], default: "standard" },
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

  // Conditions financières du marché (voir lib/market-terms).
  /** Montant contractuel TTC : base de la redevance et des pénalités quand il est renseigné. */
  amountTTC: { type: Number, min: 0 },
  /** Délai de paiement en jours calendaires ; il court de la réception de la déclaration de créance. */
  paymentDays: { type: Number, min: 0, max: 365 },
  /** Date de départ indiquée dans l'ordre de service. */
  serviceOrderDate: Date,
  executionDelay: { type: Number, min: 0, max: 3650 },
  executionUnit: { type: String, enum: ["days", "months"], default: "days" },
  /** Livraison effective : arrête le décompte des pénalités. */
  deliveredAt: Date,
  /** Pénalité journalière : 1 / diviseur du montant du marché (2000 pour 1/2000e). */
  penaltyDivisor: { type: Number, min: 1 },
  /** Plafond des pénalités, en fraction du marché (facultatif). */
  penaltyCapRate: { type: Number, min: 0, max: 1 },
  /** Redevance de régulation et FSSP : fraction du marché ; absent = taux d'office d'un marché public. */
  regulationRate: { type: Number, min: 0, max: 0.5 },
  regulationThreshold: { type: Number, min: 0 },
  /** Taux annuel des intérêts moratoires (fraction) ; absent = pas de calcul. */
  lateInterestRate: { type: Number, min: 0, max: 1 },

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

  // Exécution : devis accepté d'origine et projet qui porte les dépenses imputées.
  devisId: { type: Schema.Types.ObjectId, ref: "Devis" },
  /** Appel d'offres gagné dont le marché est issu. */
  appelId: { type: Schema.Types.ObjectId, ref: "AppelCandidature" },
  projectId: { type: Schema.Types.ObjectId, ref: "Project" },

  // Retenue de garantie : le client garde une part de chaque facture de
  // travaux jusqu'à la réception définitive (fin du délai de garantie).
  retentionRate: { type: Number, default: 0, min: 0, max: 0.1 },
  receptionProvisoireDate: Date,
  receptionDefinitiveDate: Date,
  guaranteeMonths: { type: Number, default: 12, min: 0, max: 60 },
  retentionReleases: [{
    date: { type: Date, required: true },
    amount: { type: Number, required: true, min: 1 },
    treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
    entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
    reference: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  }],

  // ── Enregistrement et timbres (CGI art. 470, 471, 481, 548, 584) ─────────
  /** Nature de l'acheteur : commande publique (5 %) ou contrat privé (2 %). Voir lib/registration. */
  buyerType: { type: String, enum: ["state", "local_authority", "public_establishment", "sem", "project", "state_funded", "private", "ngo"] },
  /** Nature de l'acte : marché, bon de commande, délégation de service public, PPP, contrat. */
  instrument: { type: String, enum: ["market", "purchase_order", "dsp", "ppp", "private_contract"], default: "market" },
  /** Approbation du marché : point de départ du délai d'enregistrement d'un mois. */
  approvalDate: Date,
  /** Contrat de sous-traitance prévu au marché principal (droit fixe de 50 000 FCFA). */
  isSubcontract: { type: Boolean, default: false },
  parentContractId: { type: Schema.Types.ObjectId, ref: "Contract" },
  /** Pages de l'acte (timbre de dimension d'un petit bon de commande). */
  pages: { type: Number, min: 1, max: 500 },
  /** Financement : budget de l'État, bailleur extérieur, ressources propres. */
  fundingSource: { type: String, enum: ["state_budget", "external", "own"] },
  /** Taux de TVA du marché (repris du devis) ; 0 pour un marché exonéré. */
  tvaRate: { type: Number, min: 0, max: 0.99 },
  /**
   * Droits constatés et payés. Le droit est une charge du marché : il entre
   * dans sa marge (catégorie « Enregistrement, impôts et taxes »).
   */
  registration: {
    kind: String,
    article: String,
    duty: { type: Number, default: 0 },
    stamp: { type: Number, default: 0 },
    receptionStamp: { type: Number, default: 0 },
    /** Total constaté (droit + timbres), dette envers l'État (447300). */
    assessed: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    dueDate: Date,
    assessedAt: Date,
    entryIds: [{ type: Schema.Types.ObjectId, ref: "AccountingEntry" }],
    payments: [{
      _id: false, date: Date, amount: Number, treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
      entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" }, movementId: { type: Schema.Types.ObjectId, ref: "TreasuryMovement" },
    }],
    /** Quittance de la recette des impôts. */
    number: String,
    date: Date,
  },

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

// Référence automatique : série « contrat » de l'organisation (compteur annuel
// atomique, préfixe paramétrable). Elle était « nombre de contrats + 1 » :
// doublons en cas de créations simultanées, compteur jamais remis à zéro.
// (Pas d'index unique : des doublons hérités de l'ancien calcul en
// empêcheraient la création en production.)
ContractSchema.pre("save", async function () {
  if (!this.reference) {
    const { nextDocumentNumber } = await import("@/lib/numbering");
    this.reference = await nextDocumentNumber(String(this.tenantId), "contract", { session: this.$session() ?? undefined });
  }
});

export const ContractModel = models.Contract || model("Contract", ContractSchema);
