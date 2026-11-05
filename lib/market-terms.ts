/**
 * Conditions financières d'un marché : redevance de régulation, pénalités de
 * retard, délai de paiement, intérêts moratoires. Fonctions pures, sans
 * dépendance serveur : elles se testent sans base et servent aussi à l'écran.
 *
 * Les valeurs par défaut viennent du marché type DRP (art. 7 : redevance et
 * contribution FSSP de 1,05 % à partir de 5 000 000 FCFA) ; chaque marché peut
 * les remplacer. Le taux des intérêts moratoires n'a pas de défaut : il se
 * renseigne une fois vérifié dans le Code des marchés publics.
 */
import { BUYER_TYPES, type BuyerType } from "@/lib/registration";

export const DEFAULT_PAYMENT_DAYS = 30;
export const REGULATION_RATE = 0.0105;
export const REGULATION_THRESHOLD = 5_000_000;
/** Base de calcul des intérêts moratoires (jours par an) : hypothèse, le texte n'étant pas vérifié. */
export const INTEREST_DAY_BASIS = 365;
/** Plafond des pénalités d'un marché public : 10 % du montant (Code des marchés publics, art. 158). */
export const PUBLIC_PENALTY_CAP = 0.1;

export interface MarketTerms {
  amount?: number; amountTTC?: number; tvaRate?: number;
  paymentDays?: number;
  serviceOrderDate?: Date | string; executionDelay?: number; executionUnit?: string; deliveredAt?: Date | string; receptionProvisoireDate?: Date | string;
  penaltyDivisor?: number; penaltyCapRate?: number;
  regulationRate?: number; regulationThreshold?: number;
  lateInterestRate?: number;
}

const DAY = 86_400_000;
/** Numéro de jour (calendrier UTC) : une différence de deux numéros compte des jours entiers. */
export function dayNumber(d: Date | string): number {
  const x = new Date(d);
  return Math.floor(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) / DAY);
}

/** Montant de référence du marché : le TTC contractuel, à défaut déduit du HT et de la TVA, sinon le HT. */
export function marketBase(c: MarketTerms): { amount: number; kind: "TTC" | "HT" } {
  if (c.amountTTC && c.amountTTC > 0) return { amount: c.amountTTC, kind: "TTC" };
  if (c.tvaRate && c.tvaRate > 0) return { amount: Math.round((c.amount ?? 0) * (1 + c.tvaRate)), kind: "TTC" };
  return { amount: c.amount ?? 0, kind: "HT" };
}

/** HT et TTC saisis qui ne concordent pas avec la TVA du marché : la marge partirait d'un mauvais montant. */
export function amountsMismatch(c: MarketTerms): boolean {
  if (!c.amountTTC || !c.amount) return false;
  if (c.amountTTC < c.amount) return true;
  if (c.tvaRate === undefined || c.tvaRate === null) return false;
  const expected = c.amount * (1 + c.tvaRate);
  return Math.abs(expected - c.amountTTC) > Math.max(2, expected * 0.005);
}

export const paymentDaysOf = (c: { paymentDays?: number }) => (c.paymentDays !== undefined && c.paymentDays !== null && c.paymentDays >= 0 ? c.paymentDays : DEFAULT_PAYMENT_DAYS);

/** Échéance d'une facture : date de départ + délai du marché, en jours calendaires. */
export function dueFrom(start: Date | string, days: number): Date {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Redevance de régulation et FSSP. D'office sur un marché public, à partir du
 * seuil ; un taux saisi sur le marché s'applique quel que soit l'acheteur, et
 * un taux de 0 la retire.
 */
export function regulationEstimate(c: MarketTerms, buyerType?: string) {
  const base = marketBase(c);
  const explicit = c.regulationRate !== undefined && c.regulationRate !== null;
  const publicBuyer = !!buyerType && !!BUYER_TYPES[buyerType as BuyerType]?.public;
  const rate = explicit ? c.regulationRate! : publicBuyer ? REGULATION_RATE : 0;
  const threshold = c.regulationThreshold ?? REGULATION_THRESHOLD;
  const applicable = rate > 0 && base.amount >= threshold;
  return { rate, threshold, base: base.amount, baseKind: base.kind, applicable, estimate: applicable ? Math.round(base.amount * rate) : 0 };
}

/** Date limite d'exécution : départ de l'ordre de service + délai (le 31 + 1 mois tombe sur le dernier jour du mois). */
export function deliveryDeadline(c: MarketTerms): Date | null {
  if (!c.serviceOrderDate || !(Number(c.executionDelay) > 0)) return null;
  const start = new Date(c.serviceOrderDate), n = Number(c.executionDelay);
  if (c.executionUnit !== "months") return dueFrom(start, n);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), last));
  return end;
}

/**
 * Pénalités de retard : (montant du marché ÷ diviseur) par jour de retard,
 * de la date limite à la livraison (ou à aujourd'hui tant qu'elle n'a pas eu
 * lieu), dans la limite du plafond s'il en existe un.
 */
export function penaltyEstimate(c: MarketTerms, asOf: Date = new Date(), buyerType?: string) {
  const deadline = deliveryDeadline(c);
  if (!deadline) return null;
  const delivered = c.deliveredAt ?? c.receptionProvisoireDate;
  const end = delivered ? new Date(delivered) : asOf;
  const daysLate = Math.max(0, dayNumber(end) - dayNumber(deadline));
  const divisor = Number(c.penaltyDivisor) > 0 ? Number(c.penaltyDivisor) : 0;
  const base = marketBase(c);
  const perDay = divisor ? Math.round(base.amount / divisor) : 0;
  const raw = divisor ? Math.round(base.amount * daysLate / divisor) : 0;
  const capRate = c.penaltyCapRate && c.penaltyCapRate > 0 ? c.penaltyCapRate : BUYER_TYPES[buyerType as BuyerType]?.public ? PUBLIC_PENALTY_CAP : 0;
  const cap = capRate > 0 ? Math.round(base.amount * capRate) : null;
  return { deadline, delivered: !!delivered, daysLate, perDay, estimate: cap !== null ? Math.min(raw, cap) : raw, capped: cap !== null && raw > cap, baseKind: base.kind };
}

/**
 * Intérêts moratoires d'une facture : intérêt simple sur le solde exigible,
 * de l'échéance jusqu'à chaque règlement, puis jusqu'à aujourd'hui s'il reste
 * un solde. Un règlement tardif ouvre donc droit à intérêts même une fois la
 * facture soldée.
 */
export function lateInterest(input: { dueDate: Date | string; amountDue: number; payments: Array<{ date: Date | string; amount: number }>; annualRate: number; asOf?: Date; dayBasis?: number }) {
  const start = dayNumber(input.dueDate), today = dayNumber(input.asOf ?? new Date()), basis = input.dayBasis ?? INTEREST_DAY_BASIS;
  let balance = input.amountDue, cursor = start, interest = 0, lastLate = 0;
  const run = (to: number) => { if (to > cursor && balance > 0) { interest += balance * input.annualRate * (to - cursor) / basis; cursor = to; } };
  for (const p of [...input.payments].sort((a, b) => dayNumber(a.date) - dayNumber(b.date))) {
    const day = dayNumber(p.date);
    run(Math.min(day, today));
    if (balance > 0 && day > start) lastLate = Math.max(lastLate, day - start);
    balance -= p.amount;
  }
  if (balance > 0) { run(today); lastLate = Math.max(lastLate, today - start); }
  return { interest: Math.round(interest), daysLate: Math.max(0, lastLate), unpaid: Math.max(0, Math.round(balance)) };
}
