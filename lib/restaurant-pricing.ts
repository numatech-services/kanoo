/**
 * Prix et marge nette des articles du restaurant, en calcul pur.
 *
 * Marge nette d'un article = prix HT − coût de revient matière − sa part des
 * frais de fonctionnement (personnel, eau, électricité, loyer et le reste).
 * Les frais sont répartis au prorata du chiffre d'affaires : « taux de frais »
 * = charges du mois de référence ÷ CA HT de ce mois. Un article qui rapporte
 * 1 000 FCFA HT porte donc 1 000 × taux de frais.
 *
 * Prix minimum pour une marge nette cible m (20 % par défaut) :
 *   prix HT ≥ coût ÷ (1 − m − taux de frais)
 * Si 1 − m − taux de frais ≤ 0, aucun prix ne suffit : les frais sont trop
 * lourds pour le chiffre d'affaires (il faut vendre plus ou réduire les frais).
 */

export const DEFAULT_TARGET_NET_MARGIN = 0.2;

/** Coût de revient unitaire : coût de l'article, ou somme de sa recette (null si un ingrédient n'a pas de coût). */
export function unitCostOf(item: { unitCost?: number; recipe?: Array<{ itemId: string; quantity: number }> }, costs: Map<string, number>): number | null {
  if (item.recipe?.length) {
    let t = 0;
    for (const r of item.recipe) {
      const c = costs.get(String(r.itemId));
      if (!c || !(c > 0)) return null;
      t += c * r.quantity;
    }
    return Math.round(t * 100) / 100;
  }
  return item.unitCost && item.unitCost > 0 ? item.unitCost : null;
}

/** Arrondi au-dessus, au pas de prix de la caisse (25 FCFA par défaut). */
export const roundUp = (n: number, step = 25) => Math.ceil(Math.round(n * 100) / 100 / step) * step;

export interface PriceCheck {
  priceTTC: number; priceHT: number; cost: number | null;
  grossMargin: number | null; grossMarginPct: number | null;
  overhead: number; netMargin: number | null; netMarginPct: number | null;
  minPriceHT: number | null; minPriceTTC: number | null;
  status: "ok" | "below" | "no_cost" | "no_price" | "impossible";
}

/** Contrôle d'un article : marge brute, part des frais, marge nette, prix minimum pour la cible. */
export function priceCheck(i: { priceTTC: number; vatRate: number; cost: number | null; overheadRate: number; target: number; step?: number }): PriceCheck {
  const priceTTC = Math.max(0, i.priceTTC || 0), vat = Math.max(0, i.vatRate || 0);
  const priceHT = Math.round((priceTTC / (1 + vat)) * 100) / 100;
  const rate = Number.isFinite(i.overheadRate) ? Math.max(0, i.overheadRate) : 0;
  const overhead = Math.round(priceHT * rate);
  const room = 1 - i.target - rate;
  const minHT = i.cost !== null && room > 0 ? i.cost / room : null;
  const base = { priceTTC, priceHT: Math.round(priceHT), cost: i.cost, overhead, minPriceHT: minHT === null ? null : Math.ceil(minHT), minPriceTTC: minHT === null ? null : roundUp(minHT * (1 + vat), i.step ?? 25) };
  if (!priceTTC) return { ...base, grossMargin: null, grossMarginPct: null, netMargin: null, netMarginPct: null, status: "no_price" };
  if (i.cost === null) return { ...base, grossMargin: null, grossMarginPct: null, netMargin: null, netMarginPct: null, status: "no_cost" };
  const gross = priceHT - i.cost, net = gross - priceHT * rate;
  const pct = (v: number) => Math.round((v / priceHT) * 1000) / 10;
  return {
    ...base, grossMargin: Math.round(gross), grossMarginPct: pct(gross), netMargin: Math.round(net), netMarginPct: pct(net),
    status: room <= 0 ? "impossible" : net / priceHT + 1e-9 >= i.target ? "ok" : "below",
  };
}

/**
 * Ce qu'il manque au restaurant pour atteindre la marge nette cible sur le
 * mois : résultat visé (cible × CA HT) moins résultat obtenu ; et la hausse
 * moyenne des prix qui le comblerait à volumes et coûts constants (une hausse
 * de prix ne change ni le coût matière ni les charges ; elle augmente le CA,
 * donc aussi la cible : x = manque ÷ (CA × (1 − cible))).
 */
export function targetGap(i: { revenueHT: number; result: number; target: number }): { targetResult: number; missing: number; priceUpliftPct: number | null } {
  const targetResult = Math.round(i.revenueHT * i.target);
  const missing = Math.max(0, targetResult - Math.round(i.result));
  const denom = i.revenueHT * (1 - i.target);
  return { targetResult, missing, priceUpliftPct: missing && denom > 0 ? Math.round((missing / denom) * 1000) / 10 : missing ? null : 0 };
}
