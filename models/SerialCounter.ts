import { Schema, model, models, Types } from "mongoose";

/**
 * Compteur d'une série de numéros à format fixe (reçus de dons et de
 * cotisations, notes de frais, inventaires, courriers, marchés) : une ligne
 * par organisation et par série annuelle (« DON-2026 »). Incrémenté de façon
 * atomique (lib/serial.ts) : deux enregistrements simultanés, ou une
 * suppression, ne redonnent jamais un numéro déjà attribué.
 */
export interface ISerialCounter { _id: Types.ObjectId; tenantId: Types.ObjectId; key: string; seq: number }

const SerialCounterSchema = new Schema<ISerialCounter>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  key: { type: String, required: true, maxlength: 60 },
  seq: { type: Number, required: true, default: 0 },
}, { timestamps: true });

SerialCounterSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const SerialCounterModel = models.SerialCounter || model<ISerialCounter>("SerialCounter", SerialCounterSchema);
