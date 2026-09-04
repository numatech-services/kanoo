import { Schema, model, models } from "mongoose";

/**
 * Courrier / correspondance administrative.
 *
 * Un document à corps libre, rendu en PDF à la marque de l'organisation
 * (en-tête, pied, couleurs). Le corps se saisit à la main ou sera proposé par
 * l'assistant IA rédactionnel. Rattaché éventuellement à un client ou à un
 * fournisseur, pour retrouver la correspondance d'un tiers.
 */
const LetterSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    reference: String,
    /** Type éditorial, pour l'assistant IA et le classement. */
    kind: {
      type: String,
      enum: ["courrier", "rapport", "attestation", "note", "reponse_ao", "autre"],
      default: "courrier",
    },
    subject: { type: String, required: true },
    recipient: String,
    place: String,
    body: { type: String, default: "" },
    signatory: String,
    status: { type: String, enum: ["draft", "final"], default: "draft" },
    /** Tiers concerné, s'il y a lieu. */
    linkedTo: { type: String, enum: ["client", "supplier", null] },
    linkedId: Schema.Types.ObjectId,
    /** Trace si le corps a été proposé par l'IA (pour l'audit et l'amélioration). */
    aiAssisted: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

LetterSchema.index({ tenantId: 1, createdAt: -1 });

export const LetterModel = models.Letter || model("Letter", LetterSchema);
