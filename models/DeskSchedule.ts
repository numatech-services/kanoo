import { Schema, model, models } from "mongoose";

/**
 * Emploi du temps du campus d'un comptoir (lib/campus) : services de repas,
 * cours (jour, heures, groupe, effectif), périodes (vacances, examens,
 * fériés, événements) et marge de sécurité. Il règle les quantités à
 * préparer et à commander.
 */
const DeskScheduleSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  services: [{ _id: false, key: { type: String, maxlength: 20 }, label: { type: String, maxlength: 40 }, from: String, to: String, base: { type: Number, min: 0, default: 0 } }],
  courses: [{ _id: false, day: { type: Number, min: 0, max: 6 }, from: String, to: String, group: { type: String, maxlength: 60 }, headcount: { type: Number, min: 1 },
    start: String, end: String, label: { type: String, maxlength: 120 } }],
  periods: [{ _id: false, from: String, to: String, label: { type: String, maxlength: 80 }, kind: { type: String, enum: ["holiday", "exams", "public_holiday", "event", "other"] }, factor: { type: Number, min: 0, max: 5 } }],
  safetyMargin: { type: Number, min: 0, max: 1, default: 0.1 },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

DeskScheduleSchema.index({ tenantId: 1, deskId: 1 }, { unique: true });

export const DeskScheduleModel = models.DeskSchedule || model("DeskSchedule", DeskScheduleSchema);
