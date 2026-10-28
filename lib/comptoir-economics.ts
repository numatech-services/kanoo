/**
 * Rentabilité prévisionnelle d'un article de comptoir (calcul pur, utilisable
 * à l'écran comme au serveur).
 *
 * Un article s'achète souvent par conditionnement (paquet de 24 sachets à
 * 5 000 FCFA) et se revend à l'unité (200 FCFA le sachet). On en tire :
 *  - le coût de revient à l'unité (5 000 / 24 = 208,33) ;
 *  - la marge unitaire HT (prix de vente HT − coût) et sa part du prix
 *    (taux de marque) ou du coût (taux de marge) ;
 *  - ce que rapporte un paquet vendu en entier ;
 *  - le prix plancher (sous lequel on vend à perte) et le prix conseillé pour
 *    un taux de marque visé.
 *
 * Le prix encaissé au comptoir est TTC : si le comptoir collecte la TVA, la
 * marge se calcule sur le HT.
 */

export interface PackInfo { label?: string; size?: number; cost?: number }

export interface EconomicsInput {
  /** Coût unitaire connu (CMUP ou saisi). Le conditionnement prime s'il est renseigné. */
  unitCost?: number;
  pack?: PackInfo | null;
  /** Prix de vente unitaire TTC. */
  salePrice?: number;
  /** Taux de TVA du comptoir (0 si non assujetti). */
  vatRate?: number;
  /** Taux de marque visé (0,30 = 30 % du prix HT), pour le prix conseillé. */
  targetMarkup?: number;
}

export interface Economics {
  unitCost: number;
  /** Coût tiré du conditionnement (vrai) ou du coût saisi (faux). */
  fromPack: boolean;
  priceTTC: number;
  priceHT: number;
  marginUnit: number;
  /** Marge ÷ prix HT. */
  markupRate: number | null;
  /** Marge ÷ coût. */
  marginRate: number | null;
  /** Paquet vendu en entier : chiffre d'affaires TTC et marge. */
  packRevenue: number | null;
  packMargin: number | null;
  /** Prix TTC sous lequel chaque vente perd de l'argent. */
  breakEvenPrice: number;
  /** Prix TTC pour atteindre le taux de marque visé. */
  suggestedPrice: number | null;
  status: "loss" | "thin" | "ok" | "unknown";
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
/** Arrondi commercial aux 25 FCFA supérieurs (pièces en circulation). */
export const roundPrice = (n: number) => Math.ceil(n / 25) * 25;

/** Seuil sous lequel la marge est jugée trop mince (taux de marque). */
export const THIN_MARKUP = 15;

export function itemEconomics(i: EconomicsInput): Economics {
  const size = i.pack?.size && i.pack.size > 0 ? i.pack.size : 0;
  const fromPack = !!(size && i.pack?.cost && i.pack.cost > 0);
  const unitCost = fromPack ? r2(i.pack!.cost! / size) : Math.max(0, i.unitCost ?? 0);
  const vat = i.vatRate && i.vatRate > 0 ? i.vatRate : 0;
  const priceTTC = Math.max(0, i.salePrice ?? 0);
  const priceHT = r2(priceTTC / (1 + vat));
  const marginUnit = r2(priceHT - unitCost);
  const known = unitCost > 0 && priceTTC > 0;
  const markupRate = known ? pct(marginUnit, priceHT) : null;
  const target = i.targetMarkup && i.targetMarkup > 0 && i.targetMarkup < 1 ? i.targetMarkup : null;
  return {
    unitCost, fromPack, priceTTC, priceHT, marginUnit,
    markupRate, marginRate: known ? pct(marginUnit, unitCost) : null,
    packRevenue: size && priceTTC ? Math.round(priceTTC * size) : null,
    packMargin: size && known ? Math.round(marginUnit * size) : null,
    breakEvenPrice: unitCost > 0 ? roundPrice(unitCost * (1 + vat)) : 0,
    suggestedPrice: unitCost > 0 && target ? roundPrice((unitCost / (1 - target)) * (1 + vat)) : null,
    status: !known ? "unknown" : marginUnit < 0 ? "loss" : (markupRate ?? 0) < THIN_MARKUP ? "thin" : "ok",
  };
}

/** Ce que vaut le stock s'il est entièrement vendu au prix affiché. */
export function stockOutlook(quantity: number, e: Economics) {
  const q = Math.max(0, quantity);
  return {
    expectedRevenue: Math.round(q * e.priceTTC),
    expectedMargin: e.status === "unknown" ? null : Math.round(q * e.marginUnit),
    stockValue: Math.round(q * e.unitCost),
  };
}

/** Entrée par conditionnement : nombre de paquets → unités et coût unitaire. */
export function packEntry(packs: number, pack: PackInfo, packCost?: number) {
  const size = pack.size && pack.size > 0 ? pack.size : 1;
  const cost = packCost && packCost > 0 ? packCost : pack.cost ?? 0;
  return { quantity: Math.round(packs * size * 1000) / 1000, unitCost: cost > 0 ? r2(cost / size) : 0, packCost: cost };
}
