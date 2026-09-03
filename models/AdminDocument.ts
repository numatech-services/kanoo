import { Schema, model, models } from "mongoose";

/**
 * Un document administratif sous surveillance.
 *
 * Le champ décisif est `leadTimeDays` : le délai d'obtention. C'est lui qui
 * détermine la date à laquelle il faut *commencer*, seule information utile —
 * une date d'expiration seule oblige chacun à faire la soustraction de tête,
 * avec un délai qui change d'un document à l'autre.
 */
const AdminDocumentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },

    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["rccm", "nif", "arf", "cnss", "patente", "agrement", "assurance", "bail",
             "contrat_travail", "visa_travail", "carte_grise", "visite_technique",
             "caution", "certificat", "autre"],
      required: true,
      index: true,
    },
    reference: String,
    /** Autorité qui délivre : c'est chez elle qu'il faut retourner. */
    issuer: String,

    issuedAt: Date,
    expiresAt: { type: Date, index: true },

    /**
     * Délai d'obtention propre à ce document, en jours.
     * Absent = celui de sa nature. L'expérience réelle d'une organisation avec
     * une administration donnée vaut mieux qu'un défaut générique.
     */
    leadTimeDays: { type: Number, min: 0 },

    /** Démarche engagée : l'alerte se tait jusqu'aux derniers jours. */
    renewalStartedAt: Date,
    renewalStartedBy: { type: Schema.Types.ObjectId, ref: "User" },
    renewalNotes: String,

    /** Document remplacé par sa nouvelle version : il sort de la veille. */
    replacedAt: Date,
    replacedBy: { type: Schema.Types.ObjectId, ref: "AdminDocument" },
    archivedAt: Date,

    /** Personnes prévenues en plus des administrateurs. */
    watchers: [{ type: Schema.Types.ObjectId, ref: "User" }],

    /** Rattachement facultatif : véhicule, salarié, contrat, marché. */
    linkedTo: String,
    linkedId: Schema.Types.ObjectId,

    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

AdminDocumentSchema.index({ tenantId: 1, expiresAt: 1 });
AdminDocumentSchema.index({ tenantId: 1, type: 1, expiresAt: 1 });

export const AdminDocumentModel =
  models.AdminDocument || model("AdminDocument", AdminDocumentSchema);
