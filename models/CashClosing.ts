import { Schema, model, models } from "mongoose";

/**
 * Arrêté de caisse ENREGISTRÉ d'un comptoir, pour une journée.
 *
 * L'arrêté n'était qu'un calcul du navigateur, imprimé puis oublié : aucun
 * écart n'était comptabilisé et les écritures de la journée restaient
 * modifiables. Une fois arrêtée, la journée est verrouillée pour ce comptoir
 * (ni vente, ni écriture, ni suppression) ; l'écart d'espèces est passé en
 * 658100 (manquant) ou 758100 (excédent).
 */
const CashClosingSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  /** Journée arrêtée (AAAA-MM-JJ, heure locale). */
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  /** Totaux théoriques par moyen de paiement (recettes − dépenses). */
  byMethod: [{ _id: false, method: String, receipts: Number, expenses: Number }],
  theoreticalCash: { type: Number, required: true },
  countedCash: { type: Number, required: true, min: 0 },
  /** Compté − théorique : < 0 manquant, > 0 excédent. */
  gap: { type: Number, required: true },
  salesCount: { type: Number, default: 0 },
  salesTTC: { type: Number, default: 0 },
  marginHT: { type: Number, default: 0 },
  notes: { type: String, maxlength: 500 },
  entryId: { type: Schema.Types.ObjectId, ref: "AccountingEntry" },
  closedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

CashClosingSchema.index({ tenantId: 1, deskId: 1, day: 1 }, { unique: true });

export const CashClosingModel = models.CashClosing || model("CashClosing", CashClosingSchema);
