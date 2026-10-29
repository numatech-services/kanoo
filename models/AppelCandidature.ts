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
export type AppelStatus = "identified" | "preparing" | "submitted" | "evaluation" | "won" | "lost" | "cancelled";

export const LOSS_REASONS = ["prix", "technique", "administratif", "hors_delai", "non_conforme", "infructueux", "autre"] as const;
export type LossReason = typeof LOSS_REASONS[number];

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
  /** Responsable du dossier (cartes, rappels). */
  ownerId?: Types.ObjectId;
  /** Dates clés de la procédure, en plus du dépôt : questions, visite de site, ouverture des plis. */
  questionsDeadline?: Date; siteVisitDate?: Date; openingDate?: Date;
  /** Entrée dans l'étape actuelle (« en évaluation depuis 7 j »). */
  stageChangedAt?: Date;
  /** Résultat de l'offre : ce qu'on a déposé, qui a gagné, pourquoi on a perdu (statistiques par motif). */
  result?: { submittedAt?: Date; offerAmount?: number; openingDate?: Date; winnerName?: string; winnerAmount?: number; rank?: number; lossReason?: LossReason; notes?: string };
  /** Décision de répondre ou non (grille pondérée, lib/go-no-go). */
  goNoGo?: { scores: Record<string, number>; score: number; decision: "go" | "review" | "no_go"; note?: string; decidedAt: Date; decidedBy: Types.ObjectId };
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RequiredDocSchema = new Schema<IRequiredDoc>({ label: { type: String, required: true }, provided: { type: Boolean, default: false } }, { _id: true });
const AppelDocSchema = new Schema<IAppelDoc>({ name: String, dataUri: String, uploadedAt: { type: Date, default: Date.now } }, { _id: true });

const AppelSchema = new Schema<IAppelCandidature>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 250 },
  result: {
    submittedAt: Date, offerAmount: { type: Number, min: 0 }, openingDate: Date,
    winnerName: { type: String, maxlength: 200 }, winnerAmount: { type: Number, min: 0 }, rank: { type: Number, min: 1 },
    lossReason: { type: String, enum: LOSS_REASONS }, notes: { type: String, maxlength: 1000 },
  },
  organism: { type: String, maxlength: 200 },
  reference: { type: String, maxlength: 100 },
  openDate: Date,
  submissionDeadline: { type: Date, index: true },
  status: { type: String, enum: ["identified", "preparing", "submitted", "evaluation", "won", "lost", "cancelled"], default: "identified", index: true },
  estimatedAmount: { type: Number, min: 0, default: 0 },
  requiredDocuments: { type: [RequiredDocSchema], default: [] },
  documents: { type: [AppelDocSchema], default: [] },
  contractId: { type: Schema.Types.ObjectId, ref: "Contract" },
  projectId: { type: Schema.Types.ObjectId, ref: "Project" },
  notes: String,
  ownerId: { type: Schema.Types.ObjectId, ref: "User" },
  questionsDeadline: Date, siteVisitDate: Date, openingDate: Date,
  stageChangedAt: Date,
  goNoGo: {
    scores: { type: Schema.Types.Mixed },
    score: Number,
    decision: { type: String, enum: ["go", "review", "no_go"] },
    note: { type: String, maxlength: 2000 },
    decidedAt: Date,
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

AppelSchema.index({ tenantId: 1, status: 1, submissionDeadline: 1 });

export const AppelCandidatureModel = models.AppelCandidature || model<IAppelCandidature>("AppelCandidature", AppelSchema);
