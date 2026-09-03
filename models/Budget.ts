import { Schema, model, models } from "mongoose";

const BudgetLineSchema = new Schema(
  {
    /**
     * Préfixe de compte SYSCOHADA. « 60 » attrape tous les achats, « 6061 »
     * le seul carburant. Le rapprochement avec le réalisé passe par là : il
     * s'appuie sur les écritures comptables, pas sur un comptage parallèle qui
     * finirait par diverger.
     */
    accountPrefix: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    nature: { type: String, enum: ["revenue", "expense"], required: true },
    annualAmount: { type: Number, required: true },

    /**
     * Répartition mensuelle en douze poids. Absente = douzièmes égaux.
     * Une entreprise de BTP ne facture pas en août comme en novembre : un
     * budget en douzièmes produit une alerte tous les mois creux.
     */
    monthlyWeights: { type: [Number], default: undefined },
    spread: { type: String, enum: ["even", "manual", "seasonal"], default: "even" },
    notes: String,
  },
  { _id: true }
);

const BudgetSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    year: { type: Number, required: true },
    label: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ["draft", "approved", "closed"],
      default: "draft",
    },

    lines: { type: [BudgetLineSchema], default: [] },

    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Un seul budget par exercice : deux prévisions concurrentes pour la même
// année donnent deux vérités, et on cite celle qui arrange.
BudgetSchema.index({ tenantId: 1, year: 1 }, { unique: true });

export const BudgetModel = models.Budget || model("Budget", BudgetSchema);
