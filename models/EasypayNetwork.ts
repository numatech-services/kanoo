import { Schema, model, models } from "mongoose";

/**
 * Liaison réseau EasyPay (contrat 1.1, `_easypay`) : faits qui n'appartiennent
 * à aucun restaurant — recharges par les agents, versements des agents,
 * commissions sur les commandes des partenaires, reversements aux assureurs et
 * à l'opérateur télécom — et bilan du jour du réseau.
 */

/** Trace de chaque événement reçu, une seule fois (organisation + event_id). */
const EventSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  eventId: { type: String, required: true, maxlength: 64 },
  type: { type: String, required: true, maxlength: 40 },
  sequence: Number,
  businessDate: String,
  status: { type: String, enum: ["applied", "ignored"], required: true },
  note: { type: String, maxlength: 300 },
  payload: Schema.Types.Mixed,
  keyId: Schema.Types.ObjectId,
  receivedAt: { type: Date, default: Date.now },
});
EventSchema.index({ tenantId: 1, eventId: 1 }, { unique: true });
export const EasypayNetworkEventModel = models.EasypayNetworkEvent || model("EasypayNetworkEvent", EventSchema);

/** Un objet métier (une recharge, un versement, une commission, un reversement), à son dernier état. */
const FactSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ["agent_topup", "agent_remittance", "partner_earning", "partner_payout"], required: true },
  objectId: { type: String, required: true, maxlength: 64 },
  businessDate: { type: String, required: true },
  state: { type: String, maxlength: 20 },
  stateRank: { type: Number, default: 1 },
  agentRef: { type: String, maxlength: 40 },
  partnerId: { type: String, maxlength: 64 },
  partnerName: { type: String, maxlength: 160 },
  partnerType: { type: String, maxlength: 20 },
  objectType: { type: String, maxlength: 30 },
  amount: { type: Number, default: 0 },
  chargeAmount: { type: Number, default: 0 },
  commissionAmount: { type: Number, default: 0 },
  partnerAmount: { type: Number, default: 0 },
  toSettleAmount: { type: Number, default: 0 },
  reference: { type: String, maxlength: 200 },
  eventIds: { type: [String], default: [] },
  updatedAt: { type: Date, default: Date.now },
});
FactSchema.index({ tenantId: 1, kind: 1, objectId: 1 }, { unique: true });
FactSchema.index({ tenantId: 1, kind: 1, businessDate: 1 });
export const EasypayNetworkFactModel = models.EasypayNetworkFact || model("EasypayNetworkFact", FactSchema);

/** Bilan du jour du réseau : la plus grande révision fait foi. */
const DaySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  businessDate: { type: String, required: true },
  revision: { type: Number, required: true },
  eventId: String,
  matches: Boolean,
  data: Schema.Types.Mixed,
  receivedAt: { type: Date, default: Date.now },
});
DaySchema.index({ tenantId: 1, businessDate: 1 }, { unique: true });
export const EasypayNetworkDayModel = models.EasypayNetworkDay || model("EasypayNetworkDay", DaySchema);
