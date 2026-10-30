/**
 * Liaison avec EasyPay (caisse, cartes et appli des étudiants de The Spot),
 * en calcul pur — testé sans base, partagé avec l'écran.
 *
 * Répartition :
 *  - Kanoo fait foi pour les articles et les prix ; EasyPay les lit
 *    (GET /api/v1/spot/catalogue).
 *  - EasyPay fait foi pour ce qui s'est passé à la caisse : il envoie ses
 *    ventes, annulations, recharges en espèces, mouvements de stock et
 *    pré-commandes (POST /api/v1/spot/events), par lots, chacun avec son id :
 *    un lot renvoyé n'écrit rien deux fois.
 *  - Numatech détient l'argent des cartes. Une vente payée sur le solde de la
 *    carte est une créance du comptoir sur Numatech ; une recharge encaissée
 *    en espèces au comptoir est de l'argent dû à Numatech. Les deux passent
 *    par un seul compte courant (467100), soldé par les reversements.
 *  - Aucune donnée personnelle : le profil tarifaire seulement.
 */

export const EASYPAY_ACCOUNT = { accountCode: "467100", accountLabel: "EasyPay (Numatech) — compte courant" };

export const EVENT_TYPES = ["sale", "sale_void", "topup", "stock_movement", "preorder"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABELS: Record<EventType, string> = {
  sale: "Vente", sale_void: "Annulation", topup: "Recharge", stock_movement: "Stock", preorder: "Pré-commande",
};

/** Lot de 100 événements au plus. */
export const MAX_BATCH = 100;

export interface ItemRef { id: string; kanooId?: string; name: string; category?: string }
export interface SaleData {
  saleId: string; number?: string; profile?: string;
  lines: Array<{ item: ItemRef; quantity: number; unitPrice: number; components: Array<{ item: ItemRef; quantity: number }> }>;
  payments: Array<{ method: SaleMethod; amount: number }>;
}
export interface VoidData { saleId: string; reason?: string }
export interface TopupData { topupId: string; amount: number }
export interface StockData { movementId: string; kind: "receipt" | "loss" | "count"; item: ItemRef; quantity?: number; countedQuantity?: number; reason?: string }
export interface PreorderData {
  orderId: string; status: PreorderStatus; pickupDay: string; service?: string; amount?: number; sequence?: number;
  lines: Array<{ item: ItemRef; quantity: number }>;
}
export type PreorderStatus = "booked" | "ready" | "picked_up" | "cancelled" | "no_show";
export const PREORDER_STATUSES: PreorderStatus[] = ["booked", "ready", "picked_up", "cancelled", "no_show"];

export type ParsedEvent =
  | { id: string; type: "sale"; occurredAt: Date; data: SaleData }
  | { id: string; type: "sale_void"; occurredAt: Date; data: VoidData }
  | { id: string; type: "topup"; occurredAt: Date; data: TopupData }
  | { id: string; type: "stock_movement"; occurredAt: Date; data: StockData }
  | { id: string; type: "preorder"; occurredAt: Date; data: PreorderData };

const ID = /^[A-Za-z0-9_-]{8,64}$/;
/** Id d'article EasyPay : court (« pastel ») ou uuid. */
const ITEM_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 160) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

class Invalid extends Error {}
const need = (cond: boolean, msg: string) => { if (!cond) throw new Invalid(msg); };

function itemRef(v: unknown, where: string): ItemRef {
  const o = obj(v);
  const id = str(o.id, 64), name = str(o.name);
  need(ITEM_ID.test(id), `${where} : id d'article invalide.`);
  need(!!name, `${where} : nom d'article manquant.`);
  const kanooId = str(o.kanoo_id, 24);
  const category = str(o.category, 60);
  return { id, name, ...(/^[a-f0-9]{24}$/i.test(kanooId) ? { kanooId } : {}), ...(category ? { category } : {}) };
}

type SaleMethod = "cash" | "easypay" | "orange_money";

/**
 * Moyen de paiement EasyPay → moyen du ticket Kanoo (null : inconnu).
 * Carte, QR et solde : l'argent est chez Numatech (« easypay ») ; mobile
 * money encaissé à la caisse : le compte mobile money de l'organisation.
 */
export function payMethodFor(method: unknown): SaleMethod | null {
  const m = str(method, 20).toLowerCase();
  if (m === "cash") return "cash";
  if (m === "balance" || m === "card" || m === "qr" || m === "wallet") return "easypay";
  if (m === "mobile_money") return "orange_money";
  return null;
}

/** Motif libre d'une perte EasyPay → motif des pertes de Kanoo (lib/spot LOSS_REASONS). */
export function lossReasonFor(reason: unknown): string {
  const r = str(reason, 200).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (/perim|dlc|expire/.test(r)) return "expired";
  if (/cass|abim|tomb|brul|renvers/.test(r)) return "broken";
  if (/offert|geste|cadeau/.test(r)) return "offered";
  if (/personnel|staff|equipe|employe/.test(r)) return "staff";
  return "unknown";
}

/**
 * Lit et contrôle un événement reçu. Les montants sont des francs entiers ;
 * un ticket doit être payé exactement (somme des paiements = somme des lignes).
 */
export function parseEvent(raw: unknown): { ok: true; event: ParsedEvent } | { ok: false; id?: string; error: string } {
  const o = obj(raw);
  const id = str(o.id, 64);
  try {
    need(ID.test(id), "id d'événement invalide (8 à 64 caractères : lettres, chiffres, - et _).");
    need((EVENT_TYPES as readonly string[]).includes(String(o.type)), `type inconnu (${EVENT_TYPES.join(", ")}).`);
    const occurredAt = new Date(String(o.occurred_at ?? ""));
    need(!isNaN(occurredAt.getTime()), "occurred_at invalide (date ISO 8601).");
    need(occurredAt.getTime() <= Date.now() + 10 * 60_000, "occurred_at dans le futur.");
    const d = obj(o.data);
    const type = o.type as EventType;

    if (type === "sale") {
      const saleId = str(d.sale_id, 64);
      need(ID.test(saleId), "sale_id invalide.");
      const rawLines = Array.isArray(d.lines) ? d.lines : [];
      need(rawLines.length > 0 && rawLines.length <= 100, "lignes : de 1 à 100.");
      const lines = rawLines.map((l, i) => {
        const x = obj(l);
        const quantity = int(x.quantity), unitPrice = int(x.unit_price);
        need(quantity > 0, `ligne ${i + 1} : quantité entière positive attendue.`);
        need(unitPrice >= 0, `ligne ${i + 1} : prix unitaire en francs entiers attendu.`);
        const comps = Array.isArray(x.components) ? x.components : [];
        need(comps.length <= 20, `ligne ${i + 1} : 20 composants au plus.`);
        return {
          item: itemRef(x.item, `ligne ${i + 1}`), quantity, unitPrice,
          components: comps.map((c, k) => {
            const y = obj(c), q = Number(y.quantity);
            need(q > 0 && q <= 1000, `ligne ${i + 1}, composant ${k + 1} : quantité invalide.`);
            return { item: itemRef(y.item, `ligne ${i + 1}, composant ${k + 1}`), quantity: q };
          }),
        };
      });
      const rawPay = Array.isArray(d.payments) ? d.payments : [];
      need(rawPay.length > 0 && rawPay.length <= 5, "paiements : de 1 à 5.");
      const payments = rawPay.map((p, i) => {
        const x = obj(p), method = payMethodFor(x.method), amount = int(x.amount);
        need(!!method, `paiement ${i + 1} : moyen inconnu (cash, card, balance, mobile_money).`);
        need(amount > 0, `paiement ${i + 1} : montant en francs entiers attendu.`);
        return { method: method!, amount };
      });
      const total = lines.reduce((t, l) => t + l.quantity * l.unitPrice, 0);
      const paid = payments.reduce((t, p) => t + p.amount, 0);
      need(paid === total, `paiements (${paid}) différents du total des lignes (${total}).`);
      const profile = str(d.profile, 20);
      return { ok: true, event: { id, type, occurredAt, data: { saleId, ...(str(d.number, 40) ? { number: str(d.number, 40) } : {}), ...(profile ? { profile } : {}), lines, payments } } };
    }
    if (type === "sale_void") {
      const saleId = str(d.sale_id, 64);
      need(ID.test(saleId), "sale_id invalide.");
      const reason = str(d.reason, 300);
      return { ok: true, event: { id, type, occurredAt, data: { saleId, ...(reason ? { reason } : {}) } } };
    }
    if (type === "topup") {
      const topupId = str(d.topup_id, 64), amount = int(d.amount);
      need(ID.test(topupId), "topup_id invalide.");
      need(amount > 0, "montant de la recharge en francs entiers attendu.");
      need(!d.method || str(d.method, 20) === "cash", "seules les recharges en espèces encaissées au comptoir sont envoyées.");
      return { ok: true, event: { id, type, occurredAt, data: { topupId, amount } } };
    }
    if (type === "stock_movement") {
      const movementId = str(d.movement_id, 64), kind = str(d.kind, 20);
      need(ID.test(movementId), "movement_id invalide.");
      need(["receipt", "loss", "count"].includes(kind), "kind : receipt, loss ou count.");
      const item = itemRef(d.item, "article");
      const reason = str(d.reason, 200);
      if (kind === "count") {
        const counted = Number(d.counted_quantity);
        need(counted >= 0, "counted_quantity invalide.");
        return { ok: true, event: { id, type, occurredAt, data: { movementId, kind, item, countedQuantity: counted, ...(reason ? { reason } : {}) } } };
      }
      const quantity = Math.abs(Number(d.quantity));
      need(quantity > 0, "quantity invalide.");
      return { ok: true, event: { id, type, occurredAt, data: { movementId, kind: kind as "receipt" | "loss", item, quantity, ...(reason ? { reason } : {}) } } };
    }
    // preorder
    const orderId = str(d.order_id, 64), status = str(d.status, 20) as PreorderStatus, pickupDay = str(d.pickup_day, 10);
    need(ID.test(orderId), "order_id invalide.");
    need(PREORDER_STATUSES.includes(status), `status : ${PREORDER_STATUSES.join(", ")}.`);
    need(DAY.test(pickupDay), "pickup_day invalide (AAAA-MM-JJ).");
    const rawLines = Array.isArray(d.lines) ? d.lines : [];
    need(rawLines.length > 0 && rawLines.length <= 50, "lignes : de 1 à 50.");
    const lines = rawLines.map((l, i) => {
      const x = obj(l), quantity = int(x.quantity);
      need(quantity > 0, `ligne ${i + 1} : quantité invalide.`);
      return { item: itemRef(x.item, `ligne ${i + 1}`), quantity };
    });
    const service = str(d.service, 30), amount = int(d.amount), sequence = int(d.sequence);
    return { ok: true, event: { id, type, occurredAt, data: { orderId, status, pickupDay, lines, ...(service ? { service } : {}), ...(amount >= 0 ? { amount } : {}), ...(sequence >= 1 ? { sequence } : {}) } } };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, ...(id ? { id } : {}), error: e.message };
    throw e;
  }
}

/** Une pré-commande compte dans la production tant qu'elle n'est ni annulée ni retirée (le retrait est une vente). */
export const preorderPending = (s: PreorderStatus) => s === "booked" || s === "ready";

/**
 * Production d'un jour avec les pré-commandes : on prépare au moins ce qui
 * est déjà commandé, et la prévision couvre les ventes sur place.
 */
export function withPreorders(forecast: Map<string, number>, preordered: Map<string, number>) {
  const ids = new Set([...forecast.keys(), ...preordered.keys()]);
  return [...ids].map(itemId => {
    const f = forecast.get(itemId) ?? 0, p = preordered.get(itemId) ?? 0;
    return { itemId, forecast: f, preordered: p, planned: Math.max(f, p) };
  });
}

/** Nom comparable (casse, accents, espaces) pour relier un article EasyPay à un article Kanoo. */
export const sameName = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
  return n(a) === n(b);
};

/** Empreinte stable du catalogue (ETag) : EasyPay ne relit que s'il a changé. */
export function catalogueVersion(items: Array<{ id: string; name: string; price?: number; category?: string; archived?: boolean; easypayId?: string }>) {
  const text = JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)).map(i => [i.id, i.name, i.price ?? null, i.category ?? "", !!i.archived, i.easypayId ?? ""]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
