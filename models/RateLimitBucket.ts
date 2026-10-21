import { Schema, model, models } from "mongoose";

/**
 * Compteur de limitation de débit partagé (lib/rate-limit.ts) : une fenêtre
 * par couple usage × identité (`login:ip:1.2.3.4`). Survit aux redémarrages
 * et vaut pour toutes les instances de l'application. Supprimé par MongoDB
 * (index TTL) une fois la fenêtre écoulée.
 */
const RateLimitBucketSchema = new Schema(
  {
    _id: { type: String },
    count: { type: Number, required: true },
    resetAt: { type: Date, required: true },
    expireAt: { type: Date, required: true },
  },
  { versionKey: false }
);

RateLimitBucketSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitBucketModel = models.RateLimitBucket || model("RateLimitBucket", RateLimitBucketSchema);
