/**
 * Contrat EasyPay → Kanoo, version 1.1 : liaison réseau `_easypay`
 * (docs/EASYPAY-KANOO-CONTRAT-V1.1.md, §13 du contrat d'EasyPay). Calcul pur :
 * lecture et contrôle d'un événement, sans base.
 *
 * Seuls les `.recorded` apportent des montants ; `.reconciled` et `.settled`
 * changent l'état d'un objet déjà compté. L'état ne recule jamais.
 */
import { SPEC_VERSION } from "@/lib/easypay-v1";

export const NETWORK_SITE = "_easypay";
const EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown, max = 160) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
/** Jour réel (le 31 novembre n'existe pas). */
export const realDay = (v: string) => DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const money = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1e12 ? v : NaN);

export type FactKind = "agent_topup" | "agent_remittance" | "partner_earning" | "partner_payout";
export interface NetworkFact {
  kind: FactKind; objectId: string; state: string; stateRank: number;
  agentRef?: string; partnerId?: string; partnerName?: string; partnerType?: string; objectType?: string;
  amount: number; chargeAmount: number; commissionAmount: number; partnerAmount: number; toSettleAmount: number; reference?: string;
  data: Record<string, unknown>;
}
export interface NetworkEnvelope { eventId: string; type: string; sequence: number; businessDate: string; occurredAt: string }
export type NetworkPlan =
  | { kind: "fact"; env: NetworkEnvelope; fact: NetworkFact }
  | { kind: "day"; env: NetworkEnvelope; businessDate: string; revision: number; matches: boolean | null; data: Record<string, unknown> }
  | { kind: "ignored"; env: NetworkEnvelope }
  | { kind: "invalid"; error: string; eventId?: string };

const partnerOf = (d: Record<string, unknown>) => { const p = obj(d.partner); return { partnerId: str(p.id, 64), partnerName: str(p.name, 160), partnerType: str(p.type, 20) }; };

export function planNetwork(body: unknown): NetworkPlan {
  const o = obj(body), site = obj(o.site), d = obj(o.data);
  const eventId = str(o.event_id, 64);
  const bad = (error: string): NetworkPlan => ({ kind: "invalid", error, ...(eventId ? { eventId } : {}) });
  if (o.spec_version !== SPEC_VERSION) return bad(`spec_version ${SPEC_VERSION} attendue.`);
  if (!EVENT_ID.test(eventId)) return bad("event_id invalide.");
  if (site.id !== NETWORK_SITE) return bad(`site.id ${NETWORK_SITE} attendu sur la liaison réseau.`);
  const type = str(o.type, 40);
  const sequence = typeof o.sequence === "number" && Number.isInteger(o.sequence) ? o.sequence : NaN;
  if (!(sequence >= 1)) return bad("sequence : entier à partir de 1 attendu.");
  const occurredAt = str(o.occurred_at, 40);
  if (isNaN(new Date(occurredAt).getTime())) return bad("occurred_at invalide (ISO 8601).");
  const businessDate = str(o.business_date, 10);
  if (!realDay(businessDate)) return bad("business_date invalide (AAAA-MM-JJ, jour réel).");
  const env: NetworkEnvelope = { eventId, type, sequence, businessDate, occurredAt };
  const fact = (f: Omit<NetworkFact, "data">): NetworkPlan => {
    for (const k of ["amount", "chargeAmount", "commissionAmount", "partnerAmount", "toSettleAmount"] as const) if (Number.isNaN(f[k])) return bad(`montant invalide (${k}) : francs CFA entiers attendus.`);
    if (!f.objectId) return bad("identifiant de l'objet manquant.");
    return { kind: "fact", env, fact: { ...f, data: d } };
  };

  switch (type) {
    case "agent_topup.recorded":
      if (money(d.charge_amount ?? 0) > money(d.amount)) return bad("agent_topup : frais supérieurs au montant de la recharge.");
      return fact({ kind: "agent_topup", objectId: str(d.topup_id, 64), state: "recorded", stateRank: 1, agentRef: str(d.agent_ref, 40),
        amount: money(d.amount), chargeAmount: money(d.charge_amount ?? 0), commissionAmount: money(d.commission_amount ?? 0), partnerAmount: 0, toSettleAmount: 0 });
    case "agent_remittance.recorded":
    case "agent_remittance.reconciled": {
      const reconciled = d.reconciled === true || str(d.state, 20) === "reconciled";
      // L'état suit le type : un « .reconciled » qui ne se dit pas rapproché est contraire au contrat.
      if (type.endsWith(".reconciled") && !reconciled) return bad("agent_remittance.reconciled : état rapproché attendu.");
      return fact({ kind: "agent_remittance", objectId: str(d.remittance_id, 64), state: reconciled ? "reconciled" : "handed_over", stateRank: reconciled ? 2 : 1,
        agentRef: str(d.agent_ref, 40), amount: money(d.amount), chargeAmount: 0, commissionAmount: 0, partnerAmount: 0, toSettleAmount: 0, reference: str(d.reference, 200) || undefined });
    }
    case "partner_earning.recorded":
    case "partner_earning.settled": {
      const base = money(d.base_amount), com = money(d.commission_amount), part = money(d.partner_amount);
      if (base !== com + part) return bad("partner_earning : commission + part du partenaire ≠ base.");
      const settled = str(d.state, 20) === "settled";
      if (type.endsWith(".settled") && !settled) return bad("partner_earning.settled : état réglé attendu.");
      if (money(d.to_settle_amount ?? 0) > part) return bad("partner_earning : reste dû supérieur à la part du partenaire.");
      return fact({ kind: "partner_earning", objectId: str(d.earning_id, 64), state: settled ? "settled" : "earned", stateRank: settled ? 2 : 1, ...partnerOf(d),
        objectType: str(d.object_type, 30), amount: base, chargeAmount: 0, commissionAmount: com, partnerAmount: part, toSettleAmount: money(d.to_settle_amount ?? 0) });
    }
    case "partner_payout.recorded":
      return fact({ kind: "partner_payout", objectId: str(d.payout_id, 64), state: "recorded", stateRank: 1, ...partnerOf(d),
        amount: money(d.amount), chargeAmount: 0, commissionAmount: 0, partnerAmount: 0, toSettleAmount: 0, reference: str(d.reference, 200) || undefined });
    case "network_day.closed": {
      const day = str(d.business_date, 10) || businessDate;
      const revision = typeof d.revision === "number" && Number.isInteger(d.revision) ? d.revision : NaN;
      if (!realDay(day)) return bad("data.business_date invalide.");
      if (!(revision >= 1)) return bad("data.revision : entier à partir de 1 attendu.");
      const m = obj(d.reconciliation).matches;
      return { kind: "day", env, businessDate: day, revision, matches: typeof m === "boolean" ? m : null, data: d };
    }
    default:
      return { kind: "ignored", env };
  }
}
