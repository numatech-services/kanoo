import { Schema, model, models } from "mongoose";

/**
 * Mouvement de trésorerie — ce que Kanoo sait des entrées et sorties d'un compte.
 *
 * Jusqu'ici, `TreasuryAccount.balance` était un nombre saisi une fois qu'aucune
 * route ne mettait jamais à jour : le solde affiché dérivait indéfiniment de la
 * réalité, et les paiements n'étaient même pas rattachés à un compte. Le solde
 * se **calcule** désormais : solde d'ouverture du compte, plus la somme des
 * mouvements. Un chiffre stocké finit toujours par contredire les lignes qu'il
 * est censé résumer.
 *
 * Le montant est **signé** : positif pour une entrée, négatif pour une sortie.
 * Deux champs séparés (débit/crédit) obligeraient chaque agrégation à choisir,
 * et une seule qui se tromperait fausserait le solde.
 */
const TreasuryMovementSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount", required: true, index: true },

    /** Date de valeur — celle qui compte pour le rapprochement, pas la saisie. */
    date: { type: Date, required: true },
    /** Signé : entrée positive, sortie négative. En francs entiers. */
    amount: { type: Number, required: true },
    label: { type: String, required: true, trim: true },
    /** Référence de l'opération : numéro de chèque, référence de virement… */
    reference: { type: String, trim: true },

    /** D'où vient le mouvement. `manual` couvre les saisies libres. */
    source: {
      type: String,
      enum: ["payment", "expense", "payroll", "transfer", "manual", "import"],
      default: "manual",
    },
    /** Pièce à l'origine du mouvement, quand il y en a une. */
    linkedDocType: { type: String, enum: ["invoice", "payment", "expense", "payslip", "recurringExpense", "purchase", "transfer", "manual", "desk_cash", "attendee", "membership", "donation", "contract", "guarantee", null] },
    /** Virement interne : l'autre jambe (mouvement du compte opposé). */
    transferPeerId: { type: Schema.Types.ObjectId },
    /** Écriture comptable passée pour une saisie manuelle ou un virement. */
    entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
    linkedDocId: { type: Schema.Types.ObjectId },

    // ── Rapprochement bancaire ────────────────────────────────────────────
    /** Ligne de relevé à laquelle ce mouvement est apparié. */
    statementLineId: { type: Schema.Types.ObjectId, ref: "BankStatementLine", index: true },
    reconciledAt: Date,
    reconciledBy: { type: Schema.Types.ObjectId, ref: "User" },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Le solde et les relevés se lisent par compte et par date.
TreasuryMovementSchema.index({ tenantId: 1, accountId: 1, date: -1 });
// Les mouvements non rapprochés sont la file de travail du comptable.
TreasuryMovementSchema.index({ tenantId: 1, accountId: 1, statementLineId: 1 });

export const TreasuryMovementModel =
  models.TreasuryMovement || model("TreasuryMovement", TreasuryMovementSchema);
