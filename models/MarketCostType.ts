import { Schema, model, models } from "mongoose";

/**
 * Type de dépense d'un marché (redevance, frais bancaires, livraison…), propre
 * à chaque organisation. `key` marque les types fournis d'office, dont deux
 * portent un calcul (redevance, pénalités) ; l'utilisateur ajoute les siens.
 * Le compte de charge se règle ici une fois pour toutes : la saisie d'une
 * dépense ne demande plus que le type et le montant.
 */
const MarketCostTypeSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  key: { type: String, trim: true, maxlength: 30 },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  /** Libellé normalisé : deux types ne portent pas le même nom. */
  labelKey: { type: String, required: true, maxlength: 120 },
  accountCode: { type: String, required: true, trim: true, maxlength: 12 },
  accountLabel: { type: String, trim: true, maxlength: 120 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

MarketCostTypeSchema.index({ tenantId: 1, labelKey: 1 }, { unique: true });
MarketCostTypeSchema.index({ tenantId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: "string" } } });

export const MarketCostTypeModel = models.MarketCostType || model("MarketCostType", MarketCostTypeSchema);
