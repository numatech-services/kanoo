import { Schema, model, models, Types } from "mongoose";

/**
 * Caution bancaire émise par la banque de l'organisation au profit d'un maître
 * d'ouvrage : soumission (avec l'offre), bonne exécution (à la signature),
 * restitution d'avance (contre l'avance de démarrage), retenue de garantie
 * (à la place de la retenue sur factures). C'est un engagement hors bilan :
 * seuls la commission bancaire, le dépôt éventuellement bloqué par la banque et
 * l'appel de la caution par le bénéficiaire passent en comptabilité.
 */
export type GuaranteeType = "soumission" | "bonne_execution" | "avance_demarrage" | "retenue_garantie" | "garantie_emprunt" | "autre";
export type GuaranteeDirection = "issued" | "received";
export type FeePeriod = "once" | "quarterly" | "semiannual" | "annual";
export type GuaranteeStatus = "active" | "released" | "called" | "cancelled";

export interface IBankGuarantee {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  type: GuaranteeType;
  /** issued : donnée par l'organisation (hors bilan, frais) ; received : reçue d'un fournisseur ou sous-traitant (suivi seul). */
  direction?: GuaranteeDirection;
  /** Garantie d'emprunt : emprunt couvert et forme (hypothèque, nantissement, aval…). */
  loanId?: Types.ObjectId;
  guaranteeForm?: string;
  /** Commission périodique : taux annuel sur le montant garanti et rythme de facturation par la banque. */
  feeRate?: number;
  feePeriod?: FeePeriod;
  /** Frais passés après l'émission : commissions périodiques, prorogation, dossier. */
  charges?: Array<{ _id?: Types.ObjectId; date: Date; amount: number; kind: "commission" | "prorogation" | "dossier" | "autre"; label?: string; entryId?: Types.ObjectId }>;
  reference?: string;
  /** Banque émettrice (compte de trésorerie qui paie la commission et bloque le dépôt). */
  treasuryAccountId?: Types.ObjectId;
  bankName?: string;
  beneficiary: string;
  amount: number;
  issueDate: Date;
  expiryDate?: Date;
  status: GuaranteeStatus;
  appelId?: Types.ObjectId;
  contractId?: Types.ObjectId;
  fee: number;
  feeEntryId?: Types.ObjectId;
  collateral: number;
  collateralEntryId?: Types.ObjectId;
  releasedAt?: Date;
  calledAt?: Date;
  calledAmount?: number;
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BankGuaranteeSchema = new Schema<IBankGuarantee>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  type: { type: String, enum: ["soumission", "bonne_execution", "avance_demarrage", "retenue_garantie", "garantie_emprunt", "autre"], required: true },
  direction: { type: String, enum: ["issued", "received"], default: "issued" },
  loanId: { type: Schema.Types.ObjectId, ref: "Loan" },
  guaranteeForm: { type: String, trim: true, maxlength: 120 },
  feeRate: { type: Number, min: 0, max: 0.5 },
  feePeriod: { type: String, enum: ["once", "quarterly", "semiannual", "annual"], default: "once" },
  charges: [{ date: { type: Date, required: true }, amount: { type: Number, required: true, min: 1 }, kind: { type: String, enum: ["commission", "prorogation", "dossier", "autre"], required: true }, label: String, entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" } }],
  reference: { type: String, trim: true, maxlength: 100 },
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
  bankName: { type: String, trim: true, maxlength: 120 },
  beneficiary: { type: String, required: true, trim: true, maxlength: 200 },
  amount: { type: Number, required: true, min: 1 },
  issueDate: { type: Date, required: true },
  expiryDate: Date,
  status: { type: String, enum: ["active", "released", "called", "cancelled"], default: "active", index: true },
  appelId: { type: Schema.Types.ObjectId, ref: "AppelCandidature" },
  contractId: { type: Schema.Types.ObjectId, ref: "Contract" },
  fee: { type: Number, default: 0, min: 0 },
  feeEntryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  collateral: { type: Number, default: 0, min: 0 },
  collateralEntryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  releasedAt: Date,
  calledAt: Date,
  calledAmount: Number,
  notes: { type: String, maxlength: 2000 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

BankGuaranteeSchema.index({ tenantId: 1, status: 1, expiryDate: 1 });

export const BankGuaranteeModel = models.BankGuarantee || model<IBankGuarantee>("BankGuarantee", BankGuaranteeSchema);
