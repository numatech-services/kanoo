import { Schema, model, models, Types } from "mongoose";

/**
 * Événement reçu d'une application reliée (EasyPay) : vente, annulation,
 * recharge, mouvement de stock, pré-commande. Gardé tel que reçu, une seule
 * fois (clé unique : organisation + source + id de l'événement), avec le
 * résultat de son application.
 *
 *  - applied : écrit dans Kanoo (ticket, encaissement, mouvement…) ;
 *  - failed : refusé par une règle de Kanoo (journée arrêtée, article d'une
 *    recette introuvable…) ; rejouable depuis le comptoir une fois corrigé ;
 *  - rejected : illisible (champ manquant) : à corriger à la source ;
 *  - ignored : écarté à la main par un responsable.
 */
export type IntegrationStatus = "applied" | "failed" | "rejected" | "ignored";

export interface IIntegrationEvent {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  deskId: Types.ObjectId;
  source: string;
  externalId: string;
  type: string;
  occurredAt?: Date;
  payload: Record<string, unknown>;
  status: IntegrationStatus;
  error?: string;
  attempts: number;
  /** Ce que l'événement a créé dans Kanoo (ticket, encaissement…). */
  ref?: { kind: string; id: Types.ObjectId; number?: string };
  keyId?: Types.ObjectId;
  /** Contrat v1 : rang dans la file du restaurant chez EasyPay. */
  sequence?: number;
  appliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const IntegrationEventSchema = new Schema<IIntegrationEvent>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  deskId: { type: Schema.Types.ObjectId, ref: "ActivityDesk", required: true },
  source: { type: String, required: true, maxlength: 30 },
  externalId: { type: String, required: true, maxlength: 64 },
  type: { type: String, required: true, maxlength: 30 },
  occurredAt: Date,
  payload: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ["applied", "failed", "rejected", "ignored"], required: true },
  error: { type: String, maxlength: 500 },
  attempts: { type: Number, default: 1 },
  ref: { _id: false, kind: String, id: Schema.Types.ObjectId, number: String },
  keyId: { type: Schema.Types.ObjectId, ref: "ApiKey" },
  sequence: Number,
  appliedAt: Date,
}, { timestamps: true });

IntegrationEventSchema.index({ tenantId: 1, source: 1, externalId: 1 }, { unique: true });
IntegrationEventSchema.index({ tenantId: 1, deskId: 1, status: 1, createdAt: -1 });

export const IntegrationEventModel = models.IntegrationEvent || model<IIntegrationEvent>("IntegrationEvent", IntegrationEventSchema);
