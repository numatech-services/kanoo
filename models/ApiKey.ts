import { Schema, model, models, Types } from "mongoose";

/**
 * Clé de l'API publique v1 (« kno_… »). Seule son empreinte SHA-256 est
 * gardée ; la clé n'est montrée qu'une fois, à sa création.
 *
 * Une clé du comptoir (scopes `spot:*`) est liée à UN comptoir : l'application
 * qui la porte (EasyPay) ne lit et n'écrit que celui-là.
 */
export interface IApiKey {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  /** Qui l'a créée : auteur des écritures passées par la clé. */
  userId?: Types.ObjectId;
  name: string;
  keyHash: string;
  keyPrefix?: string;
  scopes: string[];
  deskId?: Types.ObjectId;
  /** Application reliée (« easypay »). */
  source?: string;
  isActive: boolean;
  revokedAt?: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
  requestCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>({
  tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  keyHash: { type: String, required: true, unique: true },
  keyPrefix: String,
  scopes: [String],
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", index: true },
  source: { type: String, maxlength: 30 },
  isActive: { type: Boolean, default: true },
  revokedAt: Date,
  lastUsedAt: Date,
  expiresAt: Date,
  requestCount: { type: Number, default: 0 },
}, { timestamps: true });

export const ApiKeyModel = models.ApiKey || model<IApiKey>("ApiKey", ApiKeySchema);
