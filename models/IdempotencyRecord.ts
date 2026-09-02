import { Schema, model, models } from "mongoose";

/**
 * Trace d'une mutation déjà traitée, adressée par la clé fournie par le client.
 *
 * Sert au rejeu hors-ligne : quand le réseau tombe après que le serveur a
 * traité la requête mais avant que la réponse n'arrive, le client rejoue. Sans
 * cette table, le rejeu crée un doublon — et l'index unique
 * `(tenantId, number)` des factures ne l'attrape pas, chaque tentative tirant
 * un numéro neuf.
 *
 * L'unicité porte sur (tenantId, userId, key) : une clé appartient à celui qui
 * l'a émise, deux organisations ne peuvent pas se marcher dessus.
 */
const IdempotencyRecordSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true },

    /** Empreinte de la requête — détecte une clé réutilisée pour autre chose. */
    fingerprint: { type: String, required: true },

    /** "in_flight" tant que le traitement court, "done" une fois la réponse connue. */
    state: { type: String, enum: ["in_flight", "done"], default: "in_flight" },

    status: Number,
    body: Schema.Types.Mixed,

    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

IdempotencyRecordSchema.index({ tenantId: 1, userId: 1, key: 1 }, { unique: true });

// Purge automatique après 48 h : au-delà, un rejeu hors-ligne n'a plus de sens
// et la facture serait de toute façon à ressaisir.
IdempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 3600 });

export const IdempotencyRecordModel =
  models.IdempotencyRecord || model("IdempotencyRecord", IdempotencyRecordSchema);
