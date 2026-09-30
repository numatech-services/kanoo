import { Schema, model, models } from "mongoose";

/**
 * Entrepôt / lieu de stockage : magasin principal, dépôt, boutique, véhicule,
 * ou comptoir (chaque comptoir The Spot a le sien). Le stock d'un article est
 * tenu par entrepôt ; le total de l'article est la somme de ses entrepôts.
 */
const WarehouseSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  code: { type: String, required: true, trim: true, maxlength: 20 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  kind: { type: String, enum: ["main", "depot", "store", "comptoir", "vehicle", "other"], default: "depot" },
  address: { type: String, trim: true, maxlength: 240 },
  /** Comptoir (The Spot) dont c'est la réserve. */
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", index: true },
  /** Entrepôt par défaut des entrées / sorties sans entrepôt précisé. */
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  notes: { type: String, maxlength: 500 },
}, { timestamps: true });

WarehouseSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export const WarehouseModel = models.Warehouse || model("Warehouse", WarehouseSchema);
