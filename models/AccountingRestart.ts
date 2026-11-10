import { Schema, model, models } from "mongoose";

/**
 * Reprise de la comptabilité d'une organisation : export complet, puis
 * effacement des écritures, de la trésorerie et des caisses. Trace qui a
 * exporté, qui a effacé, quand, et combien de documents.
 */
const AccountingRestartSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  exportedAt: { type: Date, required: true },
  exportedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  exportCounts: { type: Schema.Types.Mixed },
  /** Empreinte SHA-256 de l'archive remise. */
  exportHash: String,
  restartedAt: Date,
  restartedBy: { type: Schema.Types.ObjectId, ref: "User" },
  /** Date de reprise : la comptable saisit ses soldes d'ouverture à cette date. */
  restartDate: Date,
  deleted: { type: Schema.Types.Mixed },
}, { timestamps: true });

export const AccountingRestartModel = models.AccountingRestart || model("AccountingRestart", AccountingRestartSchema);
