import { Schema, model, models } from "mongoose";

/**
 * Passage d'une tâche planifiée pour une période (jour, mois ou année).
 *
 * Les tâches du jour s'enchaînaient dans une seule requête bornée à 300 s :
 * coupée, elle laissait la sauvegarde et les relances non faites, sans
 * nouvelle tentative. Chaque tâche inscrit désormais son passage : un nouvel
 * appel du même groupe ne rejoue que ce qui n'est pas terminé.
 */
const CronRunSchema = new Schema({
  jobId: { type: String, required: true },
  /** « 2026-10-28 », « 2026-10 » ou « 2026 » selon la cadence. */
  period: { type: String, required: true },
  status: { type: String, enum: ["running", "done", "failed"], required: true },
  attempts: { type: Number, default: 0 },
  startedAt: Date,
  finishedAt: Date,
  summary: { type: String, maxlength: 1000 },
  error: { type: String, maxlength: 1000 },
}, { timestamps: true });

CronRunSchema.index({ jobId: 1, period: 1 }, { unique: true });
CronRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 86_400 });

export const CronRunModel = models.CronRun || model("CronRun", CronRunSchema);
