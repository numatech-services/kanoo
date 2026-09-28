import { Schema, model, models, Types } from "mongoose";

/**
 * Licence ISIC = droit annuel d'un étudiant pour une année académique
 * (« 2025-2026 »). Une seule par étudiant et par année : c'est ce qui permet de
 * compter les étudiants couverts, les nouveaux, les renouvellements et ceux à
 * relancer. Au renouvellement, l'étudiant garde son numéro (porté par sa fiche).
 */
export interface IIsicLicense {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  studentId: Types.ObjectId;
  academicYear: string;
  validUntil: Date;
  source: "reprise" | "lot" | "renouvellement" | "manuel";
  batchId?: Types.ObjectId;
  status: "active" | "cancelled";
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const IsicLicenseSchema = new Schema<IIsicLicense>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: "IsicStudent", required: true, index: true },
  academicYear: { type: String, required: true, match: /^\d{4}-\d{4}$/ },
  validUntil: { type: Date, required: true },
  source: { type: String, enum: ["reprise", "lot", "renouvellement", "manuel"], default: "manuel" },
  batchId: { type: Schema.Types.ObjectId, ref: "IsicBatch" },
  status: { type: String, enum: ["active", "cancelled"], default: "active", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

IsicLicenseSchema.index({ tenantId: 1, studentId: 1, academicYear: 1 }, { unique: true });
IsicLicenseSchema.index({ tenantId: 1, academicYear: 1, status: 1 });

export const IsicLicenseModel = models.IsicLicense || model<IIsicLicense>("IsicLicense", IsicLicenseSchema);
