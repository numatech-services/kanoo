import { Schema, model, models, Types } from "mongoose";

/**
 * Appel à candidatures / appel d'offres auquel l'organisation RÉPOND (elle
 * prépare et dépose un dossier avant une date limite). Distinct de PublicTender
 * (les marchés que l'administration LANCE).
 *
 * Suit : émetteur, référence, date limite de dépôt, étapes (identifié →
 * préparation → déposé → gagné/perdu), pièces exigées (à cocher), documents
 * joints, et rattachement à un contrat / projet une fois gagné.
 */
export type AppelStatus = "identified" | "preparing" | "submitted" | "won" | "lost" | "cancelled";

export interface IRequiredDoc { _id?: Types.ObjectId; label: string; provided: boolean }
export interface IAppelDoc { _id?: Types.ObjectId; name?: string; dataUri?: string; uploadedAt?: Date }

export interface IAppelCandidature {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  title: string;
  organism?: string;
  reference?: string;
  openDate?: Date;
  submissionDeadline?: Date;
  status: AppelStatus;
  estimatedAmount: number;
  requiredDocuments: IRequiredDoc[];
  documents: IAppelDoc[];
  contractId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RequiredDocSchema = new Schema<IRequiredDoc>({ label: { type: String, required: true }, provided: { type: Boolean, default: false } }, { _id: true });
const AppelDocSchema = new Schema<IAppelDoc>({ name: String, dataUri: String, uploadedAt: { type: Date, default: Date.now } }, { _id: true });

const AppelSchema = new Schema<IAppelCandidature>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 250 },
  organism: { type: String, maxlength: 200 },
  reference: { type: String, maxlength: 100 },
  openDate: Date,
  submissionDeadline: { type: Date, index: true },
  status: { type: String, enum: ["identified", "preparing", "submitted", "won", "lost", "cancelled"], default: "identified", index: true },
  estimatedAmount: { type: Number, min: 0, default: 0 },
  requiredDocuments: { type: [RequiredDocSchema], default: [] },
  documents: { type: [AppelDocSchema], default: [] },
  contractId: { type: Schema.Types.ObjectId, ref: "Contract" },
  projectId: { type: Schema.Types.ObjectId, ref: "Project" },
  notes: String,
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

AppelSchema.index({ tenantId: 1, status: 1, submissionDeadline: 1 });

export const AppelCandidatureModel = models.AppelCandidature || model<IAppelCandidature>("AppelCandidature", AppelSchema);
