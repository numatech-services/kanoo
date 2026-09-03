import { Schema, model, models } from "mongoose";

/**
 * Ligne d'un relevé bancaire importé — ce que **la banque** dit.
 *
 * Volontairement distincte du mouvement de trésorerie, qui est ce que **Kanoo**
 * sait. Le rapprochement consiste à apparier les deux, et l'écart entre eux est
 * précisément l'information utile : un mouvement sans ligne de relevé est un
 * encaissement annoncé mais pas encore reçu ; une ligne sans mouvement est une
 * opération que personne n'a saisie — un prélèvement oublié, des frais
 * bancaires, un virement client non identifié.
 *
 * Les fondre en une seule table ferait disparaître cet écart, c'est-à-dire tout
 * l'intérêt de l'exercice.
 */
const BankStatementLineSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount", required: true, index: true },

    /** Date de valeur telle qu'elle figure au relevé. */
    date: { type: Date, required: true },
    /** Signé : crédit positif, débit négatif. En francs entiers. */
    amount: { type: Number, required: true },
    /** Libellé brut de la banque, jamais réécrit : il sert à l'appariement. */
    label: { type: String, required: true, trim: true },
    reference: { type: String, trim: true },

    /**
     * Empreinte de la ligne, pour ne pas importer deux fois le même relevé.
     * Calculée sur compte + date + montant + libellé.
     */
    fingerprint: { type: String, required: true },

    /** Lot d'import, pour pouvoir annuler une importation entière. */
    importBatchId: { type: String, required: true, index: true },
    importedAt: { type: Date, default: Date.now },

    /** Mouvement Kanoo apparié, le cas échéant. */
    movementId: { type: Schema.Types.ObjectId, ref: "TreasuryMovement", index: true },
    reconciledAt: Date,

    /**
     * Ligne écartée du rapprochement par un utilisateur : elle ne correspond à
     * rien de connu et n'a pas vocation à en trouver. On la marque plutôt que
     * de la supprimer — elle appartient au relevé.
     */
    ignoredAt: Date,
    ignoreReason: String,
  },
  { timestamps: true }
);

// L'empreinte garantit qu'un relevé importé deux fois ne double pas les lignes.
BankStatementLineSchema.index({ tenantId: 1, accountId: 1, fingerprint: 1 }, { unique: true });
BankStatementLineSchema.index({ tenantId: 1, accountId: 1, date: -1 });
BankStatementLineSchema.index({ tenantId: 1, accountId: 1, movementId: 1 });

export const BankStatementLineModel =
  models.BankStatementLine || model("BankStatementLine", BankStatementLineSchema);
