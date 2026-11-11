import { Schema, model, models } from "mongoose";

/**
 * Emprunt souscrit auprès d'une banque ou d'un organisme : capital, taux,
 * durée, différé, tableau d'amortissement. Le déblocage et chaque échéance
 * payée passent en comptabilité (162 / 671 / 625 / banque) et en trésorerie.
 * Un emprunt antérieur à la reprise de la comptabilité se suit sans écriture
 * avant `postedFrom` : son capital restant entre dans les soldes d'ouverture.
 */
const InstallmentSchema = new Schema({
  n: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  principal: { type: Number, required: true, min: 0 },
  interest: { type: Number, required: true, min: 0 },
  insurance: { type: Number, default: 0, min: 0 },
  /** prior : échéance antérieure à la reprise, payée hors Kanoo. */
  status: { type: String, enum: ["due", "paid", "prior"], default: "due" },
  paidAt: Date,
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },
  entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  movementId: { type: Schema.Types.ObjectId, ref: "TreasuryMovement" },
  /** Montants ajustés à la main pour suivre le tableau remis par la banque. */
  adjusted: { type: Boolean, default: false },
  /** Capital éteint par l'appel de la caution qui garantissait l'emprunt (écriture portée par la caution). */
  byGuarantee: { type: Schema.Types.ObjectId, ref: "BankGuarantee" },
}, { _id: true });

const LoanSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  label: { type: String, required: true, trim: true, maxlength: 160 },
  lender: { type: String, required: true, trim: true, maxlength: 160 },
  /** Prêteur : banque, associé, particulier, entreprise, autre (prêts hors circuit bancaire compris). */
  lenderType: { type: String, enum: ["bank", "associate", "individual", "company", "other"], default: "bank" },
  /** Compte de la dette (162 banque, 462 associé, 168 autres), proposé selon le prêteur, modifiable par le comptable. */
  capitalAccountCode: { type: String, default: "162000" },
  capitalAccountLabel: { type: String },
  /** Capital restant dû à la date de prise en compte (emprunt antérieur à la reprise). */
  openingRemaining: { type: Number, min: 0 },
  reference: { type: String, trim: true, maxlength: 80 },
  /** Compte de trésorerie crédité au déblocage et débité des échéances. */
  treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount", required: true },
  principal: { type: Number, required: true, min: 1 },
  annualRate: { type: Number, required: true, min: 0, max: 1 },
  durationMonths: { type: Number, required: true, min: 1, max: 600 },
  frequency: { type: String, enum: ["monthly", "quarterly", "semiannual", "annual"], default: "monthly" },
  /** free : sans échéancier, remboursements libres au fil de l'eau. */
  method: { type: String, enum: ["annuity", "constant", "bullet", "free"], default: "annuity" },
  deferralPeriods: { type: Number, default: 0, min: 0 },
  startDate: { type: Date, required: true },
  /** Première échéance (échéancier) ou date de remboursement prévue (prêt libre). */
  firstDueDate: Date,
  fees: { type: Number, default: 0, min: 0 },
  insurancePerPeriod: { type: Number, default: 0, min: 0 },
  /** Retenue à la source sur les intérêts versés (prêteur non bancaire), taux à confirmer par le comptable. */
  interestWithholdingRate: { type: Number, min: 0, max: 0.5 },
  /** Objet du financement (équipement, marché, trésorerie) : imputé au projet s'il y en a un. */
  purpose: { type: String, trim: true, maxlength: 300 },
  projectId: { type: Schema.Types.ObjectId, ref: "Project" },
  /** Garanties données à la banque : hypothèque, nantissement, caution personnelle… */
  collateral: { type: String, trim: true, maxlength: 500 },
  /** Comptabilisé à partir de cette date (reprise) ; avant, l'historique est suivi sans écriture. */
  postedFrom: Date,
  status: { type: String, enum: ["draft", "active", "closed"], default: "draft" },
  disbursedAt: Date,
  disbursementEntryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  disbursementMovementId: { type: Schema.Types.ObjectId, ref: "TreasuryMovement" },
  installments: [InstallmentSchema],
  notes: { type: String, maxlength: 2000 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

LoanSchema.index({ tenantId: 1, status: 1 });

export const LoanModel = models.Loan || model("Loan", LoanSchema);
