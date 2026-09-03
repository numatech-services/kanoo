import { Schema, model, models } from "mongoose";

/**
 * Une ligne par relance — envoyée, échouée, ou rendue caduque.
 *
 * L'index d'unicité (organisation, facture, étape) est le cœur du dispositif :
 * c'est lui qui rend le job de nuit **rejouable**. Un serveur relancé deux fois
 * dans la même heure, un cron dupliqué sur deux machines, une exécution
 * manuelle lancée pendant l'automatique — dans tous ces cas la seconde
 * écriture est rejetée par la base, et le client ne reçoit pas deux fois le
 * même courrier. Un verrou applicatif ne tiendrait aucune de ces trois
 * situations.
 *
 * Les étapes `superseded` occupent leur place dans l'index sans rien envoyer :
 * elles empêchent une étape ancienne de repartir après qu'une plus avancée est
 * déjà sortie.
 */
const DunningLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client" },

    stepIndex: { type: Number, required: true },
    stepLabel: String,
    tone: { type: String, enum: ["courtesy", "reminder", "firm", "formal_notice"] },

    outcome: {
      type: String,
      enum: ["sent", "partial", "failed", "superseded"],
      required: true,
    },
    /** Canaux effectivement aboutis. Vide sur un échec. */
    channels: [{ type: String, enum: ["email", "sms", "whatsapp"] }],
    /** Détail par canal : ce qui a échoué, et pourquoi. */
    attempts: [
      {
        channel: String,
        ok: Boolean,
        error: String,
        _id: false,
      },
    ],

    /** Montant restant dû au moment de l'envoi — il bouge, la trace non. */
    outstanding: Number,
    daysPastDue: Number,

    sentAt: { type: Date, default: Date.now },
    /** Renseigné quand un humain a déclenché ou validé l'envoi. */
    triggeredBy: { type: Schema.Types.ObjectId, ref: "User" },
    automatic: { type: Boolean, default: true },
  },
  { timestamps: true }
);

DunningLogSchema.index({ tenantId: 1, invoiceId: 1, stepIndex: 1 }, { unique: true });
DunningLogSchema.index({ tenantId: 1, sentAt: -1 });

export const DunningLogModel = models.DunningLog || model("DunningLog", DunningLogSchema);
