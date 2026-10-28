import { Schema, model, models } from "mongoose";

/**
 * Période de caisse d'un comptoir (« caisse de la semaine ») : ouverte avec un
 * fonds de caisse, fermée par le comptage des espèces. Elle donne, pour la
 * période, le chiffre d'affaires, les recettes et dépenses, le solde, la
 * marge et les meilleures ventes, et se compare à la précédente.
 */
const CashSessionSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  /** Jour d'ouverture (AAAA-MM-JJ, heure locale). */
  openDay: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  openingFloat: { type: Number, required: true, min: 0 },
  label: { type: String, maxlength: 80 },
  /** Objectifs de la période (chiffre d'affaires TTC, marge HT). */
  targets: { revenue: { type: Number, min: 0 }, margin: { type: Number, min: 0 } },
  openedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["open", "closed"], default: "open" },
  closeDay: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
  closedBy: { type: Schema.Types.ObjectId, ref: "User" },
  closingId: { type: Schema.Types.ObjectId, ref: "CashClosing" },
  /** Chiffres figés à la fermeture (les tickets annulés ensuite n'y touchent plus). */
  summary: { type: Schema.Types.Mixed },
}, { timestamps: true });

// Une seule caisse ouverte par comptoir.
CashSessionSchema.index({ tenantId: 1, deskId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "open" } });
CashSessionSchema.index({ tenantId: 1, deskId: 1, openDay: -1 });

export const CashSessionModel = models.CashSession || model("CashSession", CashSessionSchema);
