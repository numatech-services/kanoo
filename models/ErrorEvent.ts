import { Schema, model, models } from "mongoose";

/**
 * Journal des erreurs de l'application (lib/error-log.ts), regroupées par
 * empreinte : une même panne répétée mille fois est une ligne avec un
 * compteur, pas mille lignes. Conservé 90 jours après la dernière occurrence.
 */
const ErrorEventSchema = new Schema(
  {
    fingerprint: { type: String, required: true, unique: true },
    source: { type: String, enum: ["api", "render", "client", "csp"], required: true },
    message: { type: String, required: true, maxlength: 1000 },
    stack: { type: String, maxlength: 4000 },
    url: { type: String, maxlength: 500 },
    /** Référence montrée à l'utilisateur (« Réf. a1b2c3 ») ou digest Next. */
    lastRef: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 300 },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant" },
    count: { type: Number, default: 0 },
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
    /** Marquée résolue par un super-administrateur ; une nouvelle occurrence la rouvre. */
    resolvedAt: Date,
  },
  { versionKey: false }
);

ErrorEventSchema.index({ lastAt: -1 });
ErrorEventSchema.index({ lastAt: 1 }, { expireAfterSeconds: 90 * 86_400, name: "ttl_lastAt" });

export const ErrorEventModel = models.ErrorEvent || model("ErrorEvent", ErrorEventSchema);
