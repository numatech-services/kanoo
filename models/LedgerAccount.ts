import { Schema, model, models } from "mongoose";

/**
 * Plan comptable de l'organisation (SYSCOHADA par défaut, enrichissable).
 * Une saisie manuelle n'accepte que des comptes du plan ; un compte déjà
 * mouvementé se désactive mais ne se supprime pas.
 */
const LedgerAccountSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  code: { type: String, required: true, trim: true, match: /^[1-9]\d{2,7}$/ },
  label: { type: String, required: true, trim: true, maxlength: 160 },
  /** Classe SYSCOHADA (premier chiffre). */
  accountClass: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  notes: { type: String, maxlength: 500 },
}, { timestamps: true });

LedgerAccountSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export const LedgerAccountModel = models.LedgerAccount || model("LedgerAccount", LedgerAccountSchema);
