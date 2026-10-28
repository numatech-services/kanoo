import { Schema, model, models } from "mongoose";

/**
 * Temps passé sur un projet (et, facultativement, une tâche) par une
 * personne, un jour donné. Base du coût interne du projet et de la
 * facturation au temps passé.
 */
const TimeEntrySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
  taskId: { type: Schema.Types.ObjectId },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: Date, required: true },
  /** Heures (au quart d'heure). */
  hours: { type: Number, required: true, min: 0.25, max: 24 },
  note: { type: String, maxlength: 300 },
  billable: { type: Boolean, default: true },
  /** Facture qui a repris ce temps. */
  invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

TimeEntrySchema.index({ tenantId: 1, projectId: 1, date: -1 });
TimeEntrySchema.index({ tenantId: 1, userId: 1, date: -1 });

export const TimeEntryModel = models.TimeEntry || model("TimeEntry", TimeEntrySchema);
