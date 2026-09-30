import { Schema, model, models } from "mongoose";

/**
 * Congé / absence d'un salarié. Demandé par le salarié (ou saisi par
 * l'Administration), validé par le chef de service ou le gérant. Seuls les
 * congés annuels approuvés entament le solde.
 */
const LeaveSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  type: { type: String, enum: ["annual", "sick", "unpaid", "maternity", "paternity", "exceptional", "training", "other"], default: "annual" },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  /** Jours ouvrables décomptés (lundi → samedi, hors jours fériés saisis). */
  days: { type: Number, required: true, min: 0.5 },
  halfDayStart: { type: Boolean, default: false },
  halfDayEnd: { type: Boolean, default: false },
  reason: { type: String, maxlength: 500 },
  status: { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending", index: true },
  decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
  decidedAt: Date,
  decisionNote: { type: String, maxlength: 500 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

LeaveSchema.index({ tenantId: 1, employeeId: 1, startDate: -1 });

export const LeaveModel = models.Leave || model("Leave", LeaveSchema);
