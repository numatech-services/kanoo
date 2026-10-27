import { Schema, model, models } from "mongoose";

/**
 * Jeton de session révoqué par une déconnexion (identifiant `jti` du JWT).
 *
 * Le jeton reste cryptographiquement valide jusqu'à son expiration : sans
 * cette liste, une déconnexion (surtout sur l'application mobile, qui n'a pas
 * de cookie à effacer) laissait le jeton utilisable huit heures par quiconque
 * l'avait copié. L'entrée disparaît d'elle-même à l'expiration du jeton
 * (index TTL) : la liste reste courte.
 */
const RevokedTokenSchema = new Schema(
  {
    _id: { type: String },
    expireAt: { type: Date, required: true },
  },
  { versionKey: false }
);

RevokedTokenSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const RevokedTokenModel = models.RevokedToken || model("RevokedToken", RevokedTokenSchema);
