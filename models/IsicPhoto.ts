import { Schema, model, models, Types } from "mongoose";

/**
 * Photo d'identité d'un étudiant du registre ISIC, compressée à l'import
 * (JPEG). Stockée à part de la fiche : les listes d'étudiants restent légères,
 * la photo n'est chargée qu'à l'affichage de la fiche ou à la génération du
 * paquet envoyé à ISIC (où elle est renommée d'après le « Personal ID »).
 */
export interface IIsicPhoto {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  studentId: Types.ObjectId;
  dataUri: string;
  bytes: number;
  originalName?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const IsicPhotoSchema = new Schema<IIsicPhoto>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: "IsicStudent", required: true },
  dataUri: { type: String, required: true },
  bytes: { type: Number, required: true },
  originalName: { type: String, maxlength: 200 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

IsicPhotoSchema.index({ tenantId: 1, studentId: 1 }, { unique: true });

export const IsicPhotoModel = models.IsicPhoto || model<IIsicPhoto>("IsicPhoto", IsicPhotoSchema);
