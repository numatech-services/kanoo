import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { withTransaction } from "@/lib/db";
import { validateApiKey, type ApiV1Context } from "@/lib/api-v1-middleware";
import { decryptField } from "@/lib/crypto-field";
import { verifySignature, SPEC_VERSION } from "@/lib/easypay-v1";
import { unauthorized, unknownSite, invalid } from "@/lib/easypay-v1-server";
import { NETWORK_SITE, type NetworkPlan } from "@/lib/easypay-network";
import { ApiKeyModel } from "@/models/ApiKey";
import { EasypayNetworkEventModel, EasypayNetworkFactModel, EasypayNetworkDayModel } from "@/models/EasypayNetwork";

export const NETWORK_SCOPE = "easypay:network";
const isDup = (e: unknown) => (e as { code?: number }).code === 11000;

/** Clé de la liaison réseau : droit easypay:network, aucune attache à un comptoir. */
export async function networkKey(req: NextRequest): Promise<{ ctx: ApiV1Context } | { error: NextResponse }> {
  const auth = await validateApiKey(req);
  if ("error" in auth) return auth;
  if (!auth.context.scopes.includes(NETWORK_SCOPE)) return { error: NextResponse.json({ error: `Scope insuffisant. Requis: ${NETWORK_SCOPE}` }, { status: 403 }) };
  return { ctx: auth.context };
}

/** Requête signée de la liaison réseau, après une poignée de main réussie (mêmes règles que le contrat v1, §3). */
export async function networkContext(req: NextRequest, raw: string): Promise<{ ctx: ApiV1Context } | { error: NextResponse }> {
  const a = await networkKey(req);
  if ("error" in a) return a;
  const version = req.headers.get("x-easypay-spec-version");
  if (version && version !== SPEC_VERSION) return { error: invalid(`spec_version ${SPEC_VERSION} attendue.`) };
  if (req.headers.get("x-easypay-site") !== NETWORK_SITE) return { error: unknownSite() };
  const key = await ApiKeyModel.findById(a.ctx.keyId).select("+signingSecret easypaySite").lean<{ signingSecret?: string; easypaySite?: string } | null>();
  if (!key?.signingSecret || key.easypaySite !== NETWORK_SITE) return { error: unauthorized() };
  let secret = "";
  try { secret = decryptField(key.signingSecret); } catch { return { error: unauthorized() }; }
  if (!verifySignature(req.headers.get("x-easypay-signature"), raw, secret)) return { error: unauthorized() };
  return { ctx: a.ctx };
}

/**
 * Reçoit un événement réseau, dans UNE transaction : trace (unique par
 * event_id), objet à son dernier état (jamais en arrière, jour comptable fixé
 * à la création), bilan à sa plus grande révision, dernier rang reçu. Une
 * panne entre deux écritures ne laisse donc jamais une trace sans son effet :
 * le renvoi d'EasyPay est traité, pas répondu « duplicate ».
 */
export async function ingestNetwork(ctx: ApiV1Context, plan: NetworkPlan, original: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  if (plan.kind === "invalid") return { status: 422, body: { error: "invalid_payload", message: plan.error } };
  const { env } = plan;
  const tid = new Types.ObjectId(ctx.tenantId);
  if (await EasypayNetworkEventModel.exists({ tenantId: tid, eventId: env.eventId })) return { status: 200, body: { status: "duplicate" } };
  try {
    await withTransaction(async session => {
      await EasypayNetworkEventModel.create([{ tenantId: tid, eventId: env.eventId, type: env.type.slice(0, 40), sequence: env.sequence, businessDate: env.businessDate,
        status: plan.kind === "ignored" ? "ignored" : "applied", ...(plan.kind === "ignored" ? { note: "type inconnu de Kanoo (version future du contrat)" } : {}), payload: original, keyId: ctx.keyId }], { session });
      await ApiKeyModel.updateOne({ _id: ctx.keyId }, { $max: { lastSequence: env.sequence } }, { session });
      if (plan.kind === "ignored") return;
      if (plan.kind === "day") {
        const key = { tenantId: tid, businessDate: plan.businessDate };
        const cur = await EasypayNetworkDayModel.findOne(key).select("revision").session(session ?? null).lean<{ revision: number } | null>();
        if (!cur) await EasypayNetworkDayModel.create([{ ...key, revision: plan.revision, eventId: env.eventId, matches: plan.matches, data: plan.data }], { session });
        else if (cur.revision < plan.revision) await EasypayNetworkDayModel.updateOne(key, { $set: { revision: plan.revision, eventId: env.eventId, matches: plan.matches, data: plan.data, receivedAt: new Date() } }, { session });
        return;
      }
      const f = plan.fact;
      const key = { tenantId: tid, kind: f.kind, objectId: f.objectId };
      const set = { state: f.state, stateRank: f.stateRank, agentRef: f.agentRef, partnerId: f.partnerId, partnerName: f.partnerName, partnerType: f.partnerType,
        objectType: f.objectType, amount: f.amount, chargeAmount: f.chargeAmount, commissionAmount: f.commissionAmount, partnerAmount: f.partnerAmount,
        toSettleAmount: f.toSettleAmount, reference: f.reference, updatedAt: new Date() };
      const cur = await EasypayNetworkFactModel.findOne(key).select("stateRank").session(session ?? null).lean<{ stateRank: number } | null>();
      // Le jour comptable est celui de l'objet (fixé à sa création) ; l'état ne recule jamais.
      if (!cur) await EasypayNetworkFactModel.create([{ ...key, ...set, businessDate: env.businessDate, eventIds: [env.eventId] }], { session });
      else if (cur.stateRank <= f.stateRank) await EasypayNetworkFactModel.updateOne(key, { $set: set, $addToSet: { eventIds: env.eventId } }, { session });
      else await EasypayNetworkFactModel.updateOne(key, { $addToSet: { eventIds: env.eventId } }, { session });
    });
  } catch (e) {
    if (isDup(e) && await EasypayNetworkEventModel.exists({ tenantId: tid, eventId: env.eventId })) return { status: 200, body: { status: "duplicate" } };
    throw e;
  }
  return { status: 200, body: { status: plan.kind === "ignored" ? "ignored" : "accepted" } };
}
