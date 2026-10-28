import { Schema, model, models } from "mongoose";
import { DEFAULT_DUNNING_SETTINGS } from "@/lib/dunning";

const DunningStepSchema = new Schema(
  {
    label: { type: String, required: true },
    offsetDays: { type: Number, required: true },
    channels: [{ type: String, enum: ["email", "sms", "whatsapp"] }],
    tone: { type: String, enum: ["courtesy", "reminder", "firm", "formal_notice"], required: true },
    notifyInternal: { type: Boolean, default: false },
    /** Une mise en demeure ne part jamais sans qu'un humain l'ait décidé. */
    requiresApproval: { type: Boolean, default: false },
  },
  { _id: false }
);

/**
 * Un document par organisation. Les relances partent au nom de l'entreprise et
 * engagent sa relation commerciale : le barème est un paramètre métier, pas une
 * constante du produit.
 *
 * `enabled` vaut `false` par défaut, délibérément. Un module qui se met à
 * écrire aux clients dès la mise à jour serait une très mauvaise surprise.
 */
const DunningSettingsSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true },
    enabled: { type: Boolean, default: false },
    steps: { type: [DunningStepSchema], default: () => DEFAULT_DUNNING_SETTINGS.steps },
    minAmount: { type: Number, default: DEFAULT_DUNNING_SETTINGS.minAmount, min: 0 },
    sendDays: { type: [Number], default: () => DEFAULT_DUNNING_SETTINGS.sendDays },
    minIntervalDays: { type: Number, default: DEFAULT_DUNNING_SETTINGS.minIntervalDays, min: 0 },
    respectDisputes: { type: Boolean, default: true },
    /** Lien du portail client (paiement en ligne) joint aux relances. */
    includePayLink: { type: Boolean, default: true },
    /** Adresse en copie des relances, pour que l'équipe garde la trace. */
    bccEmail: String,
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const DunningSettingsModel =
  models.DunningSettings || model("DunningSettings", DunningSettingsSchema);
