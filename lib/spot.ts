/**
 * Règles de gestion du comptoir (The Spot), en calcul pur — testées sans base
 * et partagées entre le serveur et l'écran :
 *  1. ardoise (crédit client) : plafond ;
 *  2. fiche recette : coût d'une préparation ;
 *  3. pertes : motifs ;
 *  4. réassort : quantité à commander ;
 *  5. objectifs de la semaine : avancement et rythme ;
 *  6. promotions : prix applicable selon le jour, l'heure et la quantité ;
 *  7. caissiers : alerte d'annulations ;
 *  8. mobile money : rapprochement avec le relevé de l'opérateur ;
 * 10. inventaire tournant : articles à compter aujourd'hui.
 */

// ── 1. Ardoise ───────────────────────────────────────────────────────────────

/** Ce qui reste autorisé sur l'ardoise d'un client (plafond 0 = pas de crédit). */
export function creditAllowance(balance: number, limit: number) {
  const remaining = Math.max(0, Math.round(limit - balance));
  return { remaining, overLimit: balance > limit };
}

/** Une vente à crédit passe-t-elle ? Message de refus sinon. */
export function creditCheck(balance: number, limit: number, amount: number): string | null {
  if (!(limit > 0)) return "Ce client n'a pas de crédit autorisé (plafond à 0).";
  if (balance + amount > limit) return `Plafond dépassé : ardoise ${Math.round(balance).toLocaleString("fr-FR")} + ${Math.round(amount).toLocaleString("fr-FR")} > plafond ${Math.round(limit).toLocaleString("fr-FR")} FCFA.`;
  return null;
}

// ── 2. Fiche recette ─────────────────────────────────────────────────────────

export interface RecipeLine { itemId: string; quantity: number }

/** Coût d'une unité préparée : somme des ingrédients × leur coût unitaire. */
export function recipeUnitCost(recipe: RecipeLine[], costOf: (itemId: string) => number): { cost: number; missing: string[] } {
  let cost = 0;
  const missing: string[] = [];
  for (const r of recipe) {
    const c = costOf(r.itemId);
    if (!(c > 0)) missing.push(r.itemId);
    cost += r.quantity * (c || 0);
  }
  return { cost: Math.round(cost * 100) / 100, missing };
}

// ── 3. Pertes ────────────────────────────────────────────────────────────────

export const LOSS_REASONS: Record<string, string> = {
  expired: "Périmé",
  broken: "Cassé / abîmé",
  offered: "Offert (geste commercial)",
  staff: "Consommé par le personnel",
  unsold: "Invendus, restes du service",
  prep_waste: "Déchets de préparation",
  prep_error: "Plat raté, erreur de préparation",
  returned: "Retour d'un client",
  unknown: "Manquant inexpliqué",
  inventory: "Écart d'inventaire",
};

// ── 4. Réassort ──────────────────────────────────────────────────────────────

export interface ReorderInput {
  stock: number;
  /** Quantité vendue (ou consommée) sur la fenêtre observée. */
  soldInWindow: number;
  windowDays: number;
  /** Délai de livraison et nombre de jours que la commande doit couvrir. */
  leadDays: number;
  coverDays: number;
  /** Unités par paquet : la commande se fait en paquets entiers. */
  packSize?: number;
  /** Seuil d'alerte de l'article : à atteindre ou au-dessous, il faut commander, même sans ventes récentes. */
  threshold?: number | null;
  /** Quantité déjà en commande (bons non encore reçus) : elle n'est pas recommandée. */
  onOrder?: number;
}

export function reorderSuggestion(i: ReorderInput) {
  const daily = i.windowDays > 0 ? i.soldInWindow / i.windowDays : 0;
  const onOrder = Math.max(0, i.onOrder ?? 0);
  const available = Math.max(0, i.stock) + onOrder;
  let need = daily * (i.leadDays + i.coverDays) - available;
  // Sous le seuil (rupture sans ventes récentes, article neuf) : remonter au-dessus du seuil.
  const underThreshold = i.threshold != null && i.threshold >= 0 && available <= i.threshold;
  if (underThreshold) need = Math.max(need, i.threshold! - available + Math.max(1, Math.ceil(daily * i.coverDays)));
  const size = i.packSize && i.packSize > 0 ? i.packSize : 1;
  const packs = need > 0 ? Math.ceil(need / size) : 0;
  return {
    dailyAverage: Math.round(daily * 100) / 100,
    daysLeft: daily > 0 ? Math.floor(Math.max(0, i.stock) / daily) : null,
    quantity: packs * size,
    packs: size > 1 ? packs : null,
    onOrder,
    // Rupture avant (ou le jour de) la livraison, ou stock (commandes comprises) au seuil.
    urgent: packs > 0 && ((daily > 0 && Math.floor(available / daily) <= i.leadDays) || underThreshold),
  };
}

// ── 5. Objectifs ─────────────────────────────────────────────────────────────

/**
 * Avancement d'un objectif sur une période de `totalDays` jours dont
 * `elapsedDays` sont écoulés (jour en cours compris). « En retard » : moins de
 * 85 % de ce que le rythme régulier aurait donné.
 */
export function targetProgress(actual: number, target: number, elapsedDays: number, totalDays = 7) {
  if (!(target > 0)) return null;
  const share = Math.min(1, Math.max(0, elapsedDays) / totalDays);
  const expected = Math.round(target * share);
  const rate = Math.round((actual / target) * 1000) / 10;
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  return {
    rate, expected,
    behind: elapsedDays > 0 && actual < expected * 0.85,
    perDayNeeded: remainingDays > 0 ? Math.max(0, Math.round((target - actual) / remainingDays)) : null,
  };
}

// ── 6. Promotions ────────────────────────────────────────────────────────────

export interface Promo {
  _id: string;
  name: string;
  itemIds?: string[];
  category?: string;
  /** percent : remise en % ; price : prix unitaire TTC imposé. */
  kind: "percent" | "price";
  value: number;
  /** Jours de la semaine (0 = dimanche). Vide : tous les jours. */
  days?: number[];
  /** Plage horaire « HH:MM » (fin exclue) ; vide : toute la journée. */
  from?: string;
  to?: string;
  /** Prix de gros : à partir de cette quantité sur la ligne. */
  minQty?: number;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  active?: boolean;
}

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };

/** La promotion s'applique-t-elle à cet article, à cet instant, pour cette quantité ? */
export function promoApplies(p: Promo, item: { _id: string; category?: string }, qty: number, at: Date): boolean {
  if (p.active === false) return false;
  if (p.itemIds?.length ? !p.itemIds.includes(item._id) : !(p.category && p.category === item.category)) return false;
  if (p.minQty && qty < p.minQty) return false;
  if (p.days?.length && !p.days.includes(at.getDay())) return false;
  const t = at.getHours() * 60 + at.getMinutes();
  if (p.from && p.to) {
    const a = minutes(p.from), b = minutes(p.to);
    if (a <= b ? t < a || t >= b : t < a && t >= b) return false;
  }
  const day = new Date(at); day.setHours(12, 0, 0, 0);
  if (p.startDate && day < new Date(new Date(p.startDate).setHours(0, 0, 0, 0))) return false;
  if (p.endDate && day > new Date(new Date(p.endDate).setHours(23, 59, 59, 999))) return false;
  return true;
}

/** Meilleur prix unitaire TTC parmi les promotions applicables (le plus bas). */
export function bestPromoPrice(listPrice: number, promos: Promo[], item: { _id: string; category?: string }, qty: number, at: Date) {
  let best: { price: number; promo: Promo } | null = null;
  for (const p of promos) {
    if (!promoApplies(p, item, qty, at)) continue;
    const price = p.kind === "percent" ? Math.round(listPrice * (1 - Math.min(100, Math.max(0, p.value)) / 100)) : Math.max(0, Math.round(p.value));
    if (price < listPrice && (!best || price < best.price)) best = { price, promo: p };
  }
  return best;
}

// ── 7. Caissiers ─────────────────────────────────────────────────────────────

/** Trop d'annulations pour un caissier sur la journée ? */
export function cancellationAlert(cancelled: number, total: number, opts: { maxCount?: number; maxRate?: number } = {}) {
  const maxCount = opts.maxCount ?? 3, maxRate = opts.maxRate ?? 0.1;
  const rate = total > 0 ? cancelled / total : 0;
  return cancelled >= maxCount || (total >= 10 && rate > maxRate);
}

// ── 8. Mobile money ──────────────────────────────────────────────────────────

export interface MomoLine { id: string; date: Date; amount: number; reference?: string; phone?: string }
export interface MomoEntry { id: string; date: Date; amount: number; label?: string }

/**
 * Rapproche les lignes du relevé de l'opérateur et les encaissements mobile
 * money du comptoir : même montant, à un jour près ; la plus proche dans le
 * temps l'emporte, chacune ne sert qu'une fois.
 */
export function matchMobileMoney(lines: MomoLine[], entries: MomoEntry[], toleranceDays = 1) {
  const free = new Set(entries.map(e => e.id));
  const pairs: Array<{ lineId: string; entryId: string }> = [];
  const sorted = [...lines].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const l of sorted) {
    let best: MomoEntry | null = null, gap = Infinity;
    for (const e of entries) {
      if (!free.has(e.id) || Math.round(e.amount) !== Math.round(l.amount)) continue;
      const d = Math.abs(e.date.getTime() - l.date.getTime());
      if (d <= toleranceDays * 86_400_000 + 3_600_000 && d < gap) { best = e; gap = d; }
    }
    if (best) { free.delete(best.id); pairs.push({ lineId: l.id, entryId: best.id }); }
  }
  const matchedLines = new Set(pairs.map(p => p.lineId));
  return {
    pairs,
    unmatchedLines: lines.filter(l => !matchedLines.has(l.id)),
    unmatchedEntries: entries.filter(e => free.has(e.id)),
  };
}

/** Lecture d'un relevé CSV (date ; montant ; référence ; téléphone), séparateur « ; » ou « , ». */
export function parseMomoCsv(text: string): { rows: Array<{ date: Date; amount: number; reference?: string; phone?: string }>; errors: string[] } {
  const rows: Array<{ date: Date; amount: number; reference?: string; phone?: string }> = [];
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const [k, raw] of lines.entries()) {
    const cells = raw.split(raw.includes(";") ? ";" : ",").map(c => c.trim().replace(/^"|"$/g, ""));
    if (k === 0 && /date/i.test(cells[0])) continue;
    const [d, a, reference, phone] = cells;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/.exec(d ?? "");
    const date = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 12), Number(m[5] ?? 0)) : new Date(d);
    const amount = Number(String(a ?? "").replace(/\s/g, "").replace(",", "."));
    if (isNaN(date.getTime()) || !(amount > 0)) { errors.push(`Ligne ${k + 1} illisible : ${raw.slice(0, 60)}`); continue; }
    rows.push({ date, amount: Math.round(amount), ...(reference ? { reference } : {}), ...(phone ? { phone } : {}) });
  }
  return { rows, errors };
}

// ── 10. Inventaire tournant ──────────────────────────────────────────────────

export interface CycleCandidate { itemId: string; stockValue: number; soldValue: number; lastCountedDays: number | null; recentLosses: number }

/**
 * Articles à compter aujourd'hui : priorité aux articles jamais (ou il y a
 * longtemps) comptés, à forte valeur ou forte rotation, et à ceux qui ont
 * connu des pertes.
 */
export function pickCycleCount(items: CycleCandidate[], size = 5): string[] {
  const score = (c: CycleCandidate) =>
    (c.lastCountedDays === null ? 60 : Math.min(60, c.lastCountedDays)) * 2
    + Math.log10(1 + c.stockValue) * 5 + Math.log10(1 + c.soldValue) * 5 + Math.min(20, c.recentLosses * 5);
  return [...items].filter(c => c.lastCountedDays === null || c.lastCountedDays >= 1)
    .sort((a, b) => score(b) - score(a)).slice(0, Math.max(1, size)).map(c => c.itemId);
}
