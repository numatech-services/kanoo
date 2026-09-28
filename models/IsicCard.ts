import { Schema, model, models, Types } from "mongoose";

/**
 * Une carte ISIC individuelle d'un lot (suivi détaillé, gros volumes).
 * Cycle : pending (importée) → numbered (numéro ISIC reçu) → printed → delivered.
 * Donnée de PRODUCTION (ressource `isic`) : l'opérateur d'impression y a accès.
 */
export interface IIsicCard {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  batchId: Types.ObjectId;
  studentName: string;
  matricule?: string;
  isicNumber?: string;
  status: "pending" | "numbered" | "printed" | "delivered";
  createdAt: Date;
  updatedAt: Date;
}

const IsicCardSchema = new Schema<IIsicCard>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  batchId: { type: Schema.Types.ObjectId, ref: "IsicBatch", required: true, index: true },
  studentName: { type: String, required: true, trim: true },
  matricule: { type: String, trim: true, index: true },
  isicNumber: { type: String, trim: true },
  status: { type: String, enum: ["pending", "numbered", "printed", "delivered"], default: "pending", index: true },
}, { timestamps: true });

IsicCardSchema.index({ tenantId: 1, batchId: 1, status: 1 });

export const IsicCardModel = models.IsicCard || model<IIsicCard>("IsicCard", IsicCardSchema);
