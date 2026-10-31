import { Schema, model, models, Types } from "mongoose";

/**
 * Poste de travail d'un collaborateur dans un restaurant : jour, service,
 * horaires prévus, puis pointage (arrivée, départ) ou absence. Base des
 * heures réelles et du coût du personnel par service.
 */
export interface IStaffShift {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  employeeId: Types.ObjectId;
  day: string;
  service: "midi" | "soir" | "jour";
  start: string;
  end: string;
  clockIn?: Date;
  clockOut?: Date;
  absent?: boolean;
  note?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const StaffShiftSchema = new Schema<IStaffShift>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  service: { type: String, enum: ["midi", "soir", "jour"], required: true },
  start: { type: String, required: true, match: HHMM },
  end: { type: String, required: true, match: HHMM },
  clockIn: Date,
  clockOut: Date,
  absent: { type: Boolean, default: false },
  note: { type: String, maxlength: 200 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

StaffShiftSchema.index({ tenantId: 1, deskId: 1, day: 1 });
StaffShiftSchema.index({ tenantId: 1, employeeId: 1, day: 1, service: 1 }, { unique: true });

export const StaffShiftModel = models.StaffShift || model<IStaffShift>("StaffShift", StaffShiftSchema);
