import { Schema, model, models } from "mongoose";

/**
 * Mémoire des automatisations : « cette alerte est déjà partie ».
 *
 * Une clé par fait signalé (`budget:<ligne>:80`, `brief:<user>:2026-10-21`,
 * `cotisation:<id>`…), unique par organisation. L'index unique rend
 * l'inscription atomique : deux exécutions simultanées de la tâche (cron
 * relancé à la main pendant qu'il tourne) n'envoient pas deux fois.
 */
const AutomationLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    key: { type: String, required: true, maxlength: 200 },
    at: { type: Date, required: true },
    note: { type: String, maxlength: 300 },
  },
  { timestamps: false }
);

AutomationLogSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const AutomationLogModel = models.AutomationLog || model("AutomationLog", AutomationLogSchema);
