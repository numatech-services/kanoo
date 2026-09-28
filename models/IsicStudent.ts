import { Schema, model, models, Types } from "mongoose";

/**
 * Registre ISIC — fiche UNIQUE d'un étudiant, tous lots et toutes années
 * confondus. Porte son numéro ISIC, qui le suit d'une année sur l'autre.
 *
 * Deux unicités garanties PAR LA BASE (pas seulement par l'écran) :
 *  - `dedupKey` (établissement + matricule) : pas de doublon d'étudiant ;
 *  - `isicNumber` : un numéro n'appartient qu'à un seul étudiant.
 */
export interface IIsicStudent {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  fullName: string;
  matricule?: string;
  schoolId?: Types.ObjectId;
  schoolName: string;
  dedupKey: string;
  email?: string;
  phone?: string;
  /** Forme canonique (majuscules, sans espaces) — voir normalizeIsicNumber. */
  isicNumber?: string;
  numberSource?: "reprise" | "isic" | "manuel";
  numberAssignedAt?: Date;
  /** Historique des numéros : changement de carte, correction… */
  numberHistory: Array<{ number: string; at: Date; by?: Types.ObjectId; reason?: string }>;
  notes?: string;
  archived: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const IsicStudentSchema = new Schema<IIsicStudent>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  fullName: { type: String, required: true, trim: true, maxlength: 200 },
  matricule: { type: String, trim: true, maxlength: 60 },
  schoolId: { type: Schema.Types.ObjectId, ref: "Client" },
  schoolName: { type: String, required: true, trim: true, maxlength: 200 },
  dedupKey: { type: String, required: true },
  email: { type: String, trim: true, lowercase: true, maxlength: 200 },
  phone: { type: String, trim: true, maxlength: 40 },
  isicNumber: { type: String, trim: true, maxlength: 40 },
  numberSource: { type: String, enum: ["reprise", "isic", "manuel"] },
  numberAssignedAt: Date,
  numberHistory: [{
    _id: false,
    number: String, at: Date, by: { type: Schema.Types.ObjectId, ref: "User" }, reason: String,
  }],
  notes: { type: String, maxlength: 1000 },
  archived: { type: Boolean, default: false, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

IsicStudentSchema.index({ tenantId: 1, dedupKey: 1 }, { unique: true });
// Unicité du numéro, seulement quand il est renseigné (étudiants « en attente »).
IsicStudentSchema.index(
  { tenantId: 1, isicNumber: 1 },
  { unique: true, partialFilterExpression: { isicNumber: { $type: "string" } } }
);
IsicStudentSchema.index({ tenantId: 1, schoolName: 1, fullName: 1 });

export const IsicStudentModel = models.IsicStudent || model<IIsicStudent>("IsicStudent", IsicStudentSchema);
