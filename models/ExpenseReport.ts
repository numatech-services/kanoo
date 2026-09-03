import { Schema, model, models } from "mongoose";

const ExpenseLineSchema = new Schema(
  {
    date: { type: Date, required: true },
    category: {
      type: String,
      enum: ["transport", "carburant", "hebergement", "restauration", "mission",
             "fournitures", "telecom", "representation", "formation", "autre"],
      required: true,
    },
    description: { type: String, required: true, trim: true },
    amountTTC: { type: Number, required: true, min: 0 },
    vatAmount: { type: Number, default: 0, min: 0 },

    /**
     * Décidé à la saisie, **figé** ensuite.
     *
     * La doctrine fiscale évolue ; une note validée l'a été sous la règle de
     * son époque. Recalculer d'après la règle du jour réécrirait le passé et
     * ferait diverger la comptabilité de ce qui a été déclaré.
     */
    vatRecoverable: { type: Boolean, required: true },

    distanceKm: Number,
    currency: { type: String, default: "XOF" },
    exchangeRate: Number,

    /** Imputation analytique facultative. */
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
    clientId: { type: Schema.Types.ObjectId, ref: "Client" },

    /**
     * Nombre de justificatifs rattachés à cette ligne.
     *
     * Dénormalisé pour que le contrôle « pas de remboursement sans pièce » ne
     * dépende pas d'une agrégation à chaque validation. La source de vérité
     * reste la collection des pièces jointes.
     */
    attachmentCount: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

/**
 * Une note de frais.
 *
 * Elle appartient à la personne qui l'a saisie, pas à celle qui la valide :
 * `employeeId` désigne le bénéficiaire du remboursement, `createdBy` l'auteur
 * de la saisie. Les deux diffèrent quand un assistant saisit pour un
 * dirigeant — cas courant, et source d'un remboursement versé au mauvais
 * compte si l'on confond les deux.
 */
const ExpenseReportSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    reference: { type: String, required: true },
    title: { type: String, required: true, trim: true },

    /** Bénéficiaire du remboursement. */
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    /** Auteur de la saisie. */
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    /** Période couverte, pour le classement et les rapprochements. */
    periodMonth: { type: Number, min: 1, max: 12 },
    periodYear: Number,

    lines: { type: [ExpenseLineSchema], default: [] },

    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected", "reimbursed"],
      default: "draft",
      index: true,
    },

    submittedAt: Date,
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    rejectedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: "User" },
    /** Exigé au refus : « refusée » sans motif est une impasse pour le salarié. */
    rejectionReason: String,

    reimbursedAt: Date,
    treasuryAccountId: { type: Schema.Types.ObjectId, ref: "TreasuryAccount" },

    /** Totaux figés à l'approbation — ils doivent correspondre à l'écriture. */
    totalTTC: { type: Number, default: 0 },
    totalVatDeducted: { type: Number, default: 0 },
    totalCharge: { type: Number, default: 0 },

    notes: String,
  },
  { timestamps: true }
);

ExpenseReportSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
ExpenseReportSchema.index({ tenantId: 1, employeeId: 1, status: 1 });
ExpenseReportSchema.index({ tenantId: 1, status: 1, submittedAt: -1 });

export const ExpenseReportModel =
  models.ExpenseReport || model("ExpenseReport", ExpenseReportSchema);
