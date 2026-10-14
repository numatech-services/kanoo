import { Schema, model, models, Types } from "mongoose";

/**
 * Caution bancaire émise par la banque de l'organisation au profit d'un maître
 * d'ouvrage : soumission (avec l'offre), bonne exécution (à la signature),
 * restitution d'avance (contre l'avance de démarrage), retenue de garantie
 * (à la place de la retenue sur factures). C'est un engagement hors bilan :
 * seuls la commission bancaire, le dépôt éventuellement bloqué par la banque et
 * l'appel de la caution par le bénéficiaire passent en comptabilité.
 */
export type GuaranteeType = "soumission" | "bonne_execution" | "avance_demarrage" | "retenue_garantie" | "autre";
export type GuaranteeStatus = "active" | "released" | "called";

export interface IBankGuarantee {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  type: GuaranteeType;
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
  type: { type: String, enum: ["soumission", "bonne_execution", "avance_demarrage", "retenue_garantie", "autre"], required: true },
  reference: { type: String, trim: true, maxlength: 100 },
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
  bankName: { type: String, trim: true, maxlength: 120 },
  beneficiary: { type: String, required: true, trim: true, maxlength: 200 },
  amount: { type: Number, required: true, min: 1 },
  issueDate: { type: Date, required: true },
  expiryDate: Date,
  status: { type: String, enum: ["active", "released", "called"], default: "active", index: true },
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
