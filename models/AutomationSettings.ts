import { Schema, model, models } from "mongoose";

/**
 * Réglages des automatisations d'une organisation (un document par
 * organisation ; absent = valeurs par défaut de lib/automations.ts).
 *
 * Règle des valeurs par défaut : une alerte interne (notification dans Kanoo)
 * est active d'office ; tout ce qui ÉCRIT à quelqu'un hors de l'application
 * (gérant par WhatsApp, comptable, adhérents) ou qui PASSE une écriture
 * comptable attend qu'un responsable l'ait activé. Un module qui se mettrait à
 * écrire ou à comptabiliser dès la mise à jour serait une mauvaise surprise.
 */
const AutomationSettingsSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true },
    morningBrief: {
      enabled: { type: Boolean, default: false },
      channels: { type: [{ type: String, enum: ["email", "whatsapp"] }], default: () => ["email"] },
      /** Jours d'envoi, 0 = dimanche … 6 = samedi. */
      days: { type: [Number], default: () => [1, 2, 3, 4, 5] },
      /** Destinataires choisis ; vide = les dirigeants de l'organisation. */
      recipientIds: { type: [Schema.Types.ObjectId], ref: "User", default: () => [] },
    },
    treasuryAlert: {
      enabled: { type: Boolean, default: true },
      horizonDays: { type: Number, default: 30, min: 7, max: 90 },
      threshold: { type: Number, default: 0 },
    },
    depreciation: {
      enabled: { type: Boolean, default: false },
    },
    payroll: {
      enabled: { type: Boolean, default: true },
      reminderDay: { type: Number, default: 25, min: 1, max: 28 },
      /** Générer d'office les bulletins à salaire fixe le dernier jour du mois. */
      autoGenerate: { type: Boolean, default: false },
    },
    accountantPacket: {
      enabled: { type: Boolean, default: false },
      emails: { type: [String], default: () => [] },
      day: { type: Number, default: 5, min: 1, max: 28 },
    },
    approvalReminders: {
      enabled: { type: Boolean, default: true },
      afterHours: { type: Number, default: 48, min: 12, max: 240 },
    },
    budgetAlerts: {
      enabled: { type: Boolean, default: true },
      thresholds: { type: [Number], default: () => [80, 100] },
    },
    cotisationReminders: {
      enabled: { type: Boolean, default: false },
      channels: { type: [{ type: String, enum: ["email", "sms", "whatsapp"] }], default: () => ["email"] },
      intervalDays: { type: Number, default: 30, min: 7, max: 120 },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const AutomationSettingsModel =
  models.AutomationSettings || model("AutomationSettings", AutomationSettingsSchema);
