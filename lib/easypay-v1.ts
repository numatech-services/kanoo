/**
 * Contrat d'interface EasyPay → Kanoo, version 1 (docs/EASYPAY-KANOO-CONTRAT-V1.md),
 * en calcul pur : signature, poignée de main et conversion d'un événement du
 * contrat vers le format interne de Kanoo (lib/easypay parseEvent), pour
 * réutiliser les mêmes contrôles et la même écriture.
 *
 * Un événement par requête, signé HMAC-SHA256 sur `<t>.<corps brut>` avec le
 * secret remis à la poignée de main. L'ancien envoi par lots ({ events: [...] })
 * reste accepté à la même adresse.
 */
import { createHmac, timingSafeEqual } from "crypto";

export const SPEC_VERSION = "1";
/** Écart d'horloge toléré entre EasyPay et Kanoo (rejeu). */
export const MAX_SKEW_SECONDS = 300;

const SECRET = /^[a-f0-9]{64}$/;
const SITE = /^[A-Za-z0-9_.-]{1,64}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown, max = 160) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);

export const hmacHex = (key: string, message: string) => createHmac("sha256", key).update(message, "utf8").digest("hex");

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * En-tête `X-EasyPay-Signature: t=<secondes>,v1=<hex>` vérifié sur le corps
 * brut, en temps constant, horloge à ±300 s. Le secret est pris tel quel
 * (64 caractères), sans décodage hexadécimal.
 */
export function verifySignature(header: string | null, rawBody: string, secret: string, nowMs = Date.now()): boolean {
  const m = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec((header ?? "").trim());
  if (!m || !secret) return false;
  const t = Number(m[1]);
  if (Math.abs(nowMs / 1000 - t) > MAX_SKEW_SECONDS) return false;
  return sameHex(hmacHex(secret, `${m[1]}.${rawBody}`), m[2]);
}

export const isSigningSecret = (v: unknown): v is string => typeof v === "string" && SECRET.test(v);
export const isSiteId = (v: unknown): v is string => typeof v === "string" && SITE.test(v);

/** Corps du nouveau contrat (un événement), par opposition à l'ancien lot. */
export const isV1Body = (body: unknown) => typeof obj(body).spec_version === "string";

/** Poignée de main lue et contrôlée. */
export function parseHandshake(body: unknown): { ok: true; siteId: string; siteName: string; secret: string; challenge: string } | { ok: false; error: string } {
  const o = obj(body), site = obj(o.site);
  if (o.spec_version !== SPEC_VERSION) return { ok: false, error: `spec_version ${SPEC_VERSION} attendue.` };
  if (o.type !== "handshake") return { ok: false, error: "type handshake attendu." };
  if (!isSiteId(site.id)) return { ok: false, error: "site.id invalide." };
  if (!isSigningSecret(o.signing_secret)) return { ok: false, error: "signing_secret : 64 caractères hexadécimaux attendus." };
  const challenge = str(o.challenge, 256);
  if (challenge.length < 16) return { ok: false, error: "challenge invalide." };
  return { ok: true, siteId: site.id as string, siteName: str(site.name, 120), secret: o.signing_secret as string, challenge };
}

/** Preuve de la poignée de main : HMAC-SHA256 du challenge avec le nouveau secret. */
export const challengeResponse = (challenge: string, secret: string) => hmacHex(secret, challenge);

/** Statut d'une commande EasyPay → statut d'une pré-commande Kanoo. */
const ORDER_STATUS: Record<string, string> = {
  received: "booked", preparing: "booked", ready: "ready", handed_over: "picked_up",
  refused: "cancelled", cancelled: "cancelled", no_show: "no_show",
};

const VOID_REASON: Record<string, string> = {
  supervisor_cancellation: "annulée par un responsable",
  unconfirmed_refused: "réponse perdue, client refusé",
};

export interface V1Envelope { eventId: string; type: string; sequence: number; siteId: string; occurredAt: string; businessDate: string; data: Record<string, unknown> }

/**
 * Ce que Kanoo fait d'un événement du contrat :
 *  - `apply` : converti au format interne (`raw`, relu par parseEvent) ;
 *  - `day` : bilan du jour, gardé à sa plus grande révision ;
 *  - `log` : gardé pour trace, sans écriture (tiroir ouvert, vente refusée
 *    avant d'arriver au serveur, annulation d'une vente jamais reçue) ;
 *  - `ignored` : type inconnu (version future), répondu 200 ;
 *  - `invalid` : contraire au contrat, répondu 422.
 */
export type V1Plan =
  | { kind: "apply"; env: V1Envelope; raw: Record<string, unknown>; voidOfUnknownSale?: boolean }
  | { kind: "day"; env: V1Envelope; businessDate: string; revision: number; data: Record<string, unknown> }
  | { kind: "log"; env: V1Envelope; note: string }
  | { kind: "ignored"; env: V1Envelope }
  | { kind: "invalid"; error: string; eventId?: string };

export function planV1(body: unknown): V1Plan {
  const o = obj(body), site = obj(o.site), d = obj(o.data);
  const eventId = str(o.event_id, 64);
  const bad = (error: string): V1Plan => ({ kind: "invalid", error, ...(eventId ? { eventId } : {}) });
  if (o.spec_version !== SPEC_VERSION) return bad(`spec_version ${SPEC_VERSION} attendue.`);
  if (!EVENT_ID.test(eventId)) return bad("event_id invalide.");
  const type = str(o.type, 40);
  if (!type) return bad("type manquant.");
  const sequence = int(o.sequence);
  if (!(sequence >= 1)) return bad("sequence : entier à partir de 1 attendu.");
  if (!isSiteId(site.id)) return bad("site.id invalide.");
  const occurredAt = str(o.occurred_at, 40);
  if (isNaN(new Date(occurredAt).getTime())) return bad("occurred_at invalide (ISO 8601).");
  const businessDate = str(o.business_date, 10);
  if (businessDate && !DAY.test(businessDate)) return bad("business_date invalide (AAAA-MM-JJ).");
  const env: V1Envelope = { eventId, type, sequence, siteId: site.id as string, occurredAt, businessDate, data: d };
  const item = (l: Record<string, unknown>) => ({ id: str(l.ref_id, 64), name: str(l.label) });
  const lines = (Array.isArray(d.lines) ? d.lines : []).map(obj);

  switch (type) {
    case "sale.recorded": {
      if (d.voided_before_arrival === true) return { kind: "log", env, note: "vente annulée par la caisse avant d'arriver au serveur : rien n'a été débité" };
      const payments = (Array.isArray(d.payments) ? d.payments : []).map(obj)
        .filter(p => int(p.amount) > 0).map(p => ({ method: str(p.method, 20), amount: int(p.amount) }));
      const ticket = d.ticket_number === null || d.ticket_number === undefined ? "" : String(d.ticket_number).slice(0, 40);
      return { kind: "apply", env, raw: {
        id: eventId, type: "sale", occurred_at: occurredAt,
        data: {
          sale_id: d.sale_id, ...(ticket ? { number: ticket } : {}), ...(str(d.price_category, 20) ? { profile: str(d.price_category, 20) } : {}),
          lines: lines.map(l => ({ item: item(l), quantity: l.quantity, unit_price: l.unit_price_amount, components: [] })),
          payments,
        },
      } };
    }
    case "sale.voided": {
      const reason = VOID_REASON[str(d.reason, 40)] ?? str(d.reason, 200);
      return { kind: "apply", env, voidOfUnknownSale: d.sale_known === false, raw: {
        id: eventId, type: "sale_void", occurred_at: occurredAt, data: { sale_id: d.sale_id, ...(reason ? { reason } : {}) },
      } };
    }
    case "topup.recorded":
      return { kind: "apply", env, raw: { id: eventId, type: "topup", occurred_at: occurredAt, data: { topup_id: d.topup_id, amount: d.amount } } };
    case "order.placed":
    case "order.updated": {
      const status = ORDER_STATUS[str(d.status, 20)];
      if (!status) return bad(`statut de commande inconnu (${Object.keys(ORDER_STATUS).join(", ")}).`);
      const pickup = str(d.pickup_date, 10) || businessDate;
      return { kind: "apply", env, raw: {
        id: eventId, type: "preorder", occurred_at: occurredAt,
        data: {
          order_id: d.order_id, status, pickup_day: pickup, sequence,
          ...(int(d.total_amount) >= 0 ? { amount: int(d.total_amount) } : {}),
          lines: lines.map(l => ({ item: item(l), quantity: l.quantity })),
        },
      } };
    }
    case "drawer.opened":
      return { kind: "log", env, note: `tiroir ouvert sans vente${str(d.reason, 120) ? ` (${str(d.reason, 120)})` : ""}${d.approved_by ? ", avec PIN d'un responsable" : ""}` };
    case "day.closed": {
      const day = str(d.business_date, 10) || businessDate, revision = int(d.revision);
      if (!DAY.test(day)) return bad("data.business_date invalide.");
      if (!(revision >= 1)) return bad("data.revision : entier à partir de 1 attendu.");
      return { kind: "day", env, businessDate: day, revision, data: d };
    }
    default:
      return { kind: "ignored", env };
  }
}
