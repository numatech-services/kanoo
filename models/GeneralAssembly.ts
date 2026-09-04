import { Schema, model, models } from "mongoose";
import { IGeneralAssembly } from "@/types";
const GASchema = new Schema<IGeneralAssembly>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, title: { type: String, required: true }, type: { type: String, enum: ["ordinary","extraordinary"], required: true }, date: { type: Date, required: true }, location: String, convocationSentAt: Date, quorumRequired: Number, quorumAchieved: Number, attendees: [Schema.Types.ObjectId], decisions: [{ text: String, votes: { for: Number, against: Number, abstain: Number }, passed: Boolean }], pvDocumentId: Schema.Types.ObjectId,
  /**
   * Procès-verbal joint, stocké en data-URI (comme les logos) : robuste sur
   * hébergement managé où le disque est éphémère. Exclu des listes (lourd).
   */
  pvFile: { name: String, dataUri: String, uploadedAt: Date } }, { timestamps: true });
export const GeneralAssemblyModel = models.GeneralAssembly || model<IGeneralAssembly>("GeneralAssembly", GASchema);
