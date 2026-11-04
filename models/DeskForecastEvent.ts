import { Schema, model, models, Types } from "mongoose";

/**
 * Événement qui change la demande d'un site sur une période : vacances,
 * fête, promotion, commande de groupe. Sans site désigné, il vaut pour tous.
 * `factor` multiplie la prévision (0,2 : baisse de 80 %) ; `extra` ajoute des
 * portions par jour.
 */
export interface IDeskForecastEvent {
  _id: Types.ObjectId; tenantId: Types.ObjectId; deskIds: Types.ObjectId[];
  from: string; to: string; label: string; factor: number; note?: string; createdBy: Types.ObjectId;
}

const DeskForecastEventSchema = new Schema<IDeskForecastEvent>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskIds: [{ type: Schema.Types.ObjectId, ref: "ActivityDesk" }],
  from: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  to: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  factor: { type: Number, required: true, min: 0, max: 10 },
  note: { type: String, maxlength: 300 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

DeskForecastEventSchema.index({ tenantId: 1, from: 1, to: 1 });

export const DeskForecastEventModel = models.DeskForecastEvent || model<IDeskForecastEvent>("DeskForecastEvent", DeskForecastEventSchema);
