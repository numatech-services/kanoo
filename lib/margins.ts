/**
 * Marges : calculs purs (testés sans base).
 *
 *  - marge brute HT = prix de vente HT − coût ;
 *  - taux de marge = marge / coût (ce que rapporte un franc investi) ;
 *  - taux de marque = marge / prix de vente HT (part du prix qui reste).
 *
 * Un article sans coût d'achat n'a PAS 100 % de marge : il est « non
 * valorisé », compté à part, et exclu des taux.
 */

export interface SaleLineInput { quantity: number; unitPriceTTC: number; discount: number; tvaRate: number; unitCost: number }
export interface SaleLineComputed {
  quantity: number; unitPriceTTC: number; discount: number; tvaRate: number;
  totalTTC: number; totalHT: number; totalTVA: number; unitCost: number; costTotal: number; marginHT: number | null;
}

/** Ligne de ticket : prix TTC remisé, HT extrait au taux de l'article, coût et marge. */
export function saleLine(i: SaleLineInput): SaleLineComputed {
  const discount = Math.min(100, Math.max(0, Number(i.discount) || 0));
  const totalTTC = Math.round(i.quantity * i.unitPriceTTC * (1 - discount / 100));
  const rate = i.tvaRate > 0 ? i.tvaRate : 0;
  const totalHT = rate ? Math.round(totalTTC / (1 + rate)) : totalTTC;
  const unitCost = Math.max(0, Number(i.unitCost) || 0);
  const costTotal = Math.round(unitCost * i.quantity);
  return {
    quantity: i.quantity, unitPriceTTC: i.unitPriceTTC, discount, tvaRate: rate,
    totalTTC, totalHT, totalTVA: totalTTC - totalHT, unitCost, costTotal,
    marginHT: unitCost > 0 ? totalHT - costTotal : null,
  };
}

export interface MarginRow {
  key: string; label: string; category?: string;
  quantity: number; revenueHT: number; costTotal: number; marginHT: number;
  /** CA HT des ventes sans coût connu (exclu de la marge et des taux). */
  unvaluedRevenueHT: number;
  marginRate: number | null; markupRate: number | null;
  belowCost: boolean;
}

export interface MarginFact {
  key: string; label: string; category?: string;
  quantity: number; revenueHT: number; costTotal: number;
  /** Faux : coût inconnu. */
  valued: boolean;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Agrège des lignes vendues par clé (produit, catégorie, jour, caissier…). */
export function aggregateMargins(facts: MarginFact[]): MarginRow[] {
  const by = new Map<string, MarginRow>();
  for (const f of facts) {
    const r = by.get(f.key) ?? { key: f.key, label: f.label, category: f.category, quantity: 0, revenueHT: 0, costTotal: 0, marginHT: 0, unvaluedRevenueHT: 0, marginRate: null, markupRate: null, belowCost: false };
    r.quantity += f.quantity;
    if (f.valued) { r.revenueHT += f.revenueHT; r.costTotal += f.costTotal; r.marginHT += f.revenueHT - f.costTotal; }
    else r.unvaluedRevenueHT += f.revenueHT;
    by.set(f.key, r);
  }
  return [...by.values()].map(r => ({
    ...r,
    marginRate: pct(r.marginHT, r.costTotal),
    markupRate: pct(r.marginHT, r.revenueHT),
    belowCost: r.revenueHT > 0 && r.marginHT < 0,
  })).sort((a, b) => b.marginHT - a.marginHT);
}

export function marginTotals(rows: MarginRow[]) {
  const t = rows.reduce((a, r) => ({ revenueHT: a.revenueHT + r.revenueHT, costTotal: a.costTotal + r.costTotal, marginHT: a.marginHT + r.marginHT, unvaluedRevenueHT: a.unvaluedRevenueHT + r.unvaluedRevenueHT }), { revenueHT: 0, costTotal: 0, marginHT: 0, unvaluedRevenueHT: 0 });
  return { ...t, marginRate: pct(t.marginHT, t.costTotal), markupRate: pct(t.marginHT, t.revenueHT) };
}

/**
 * Coût unitaire rendu de chaque ligne reçue : prix d'achat + part des frais
 * d'approche, répartis au prorata de la valeur des articles STOCKÉS (une ligne
 * hors stock garde son prix). Arrondi au centime ; la dernière ligne stockée
 * absorbe l'arrondi.
 */
export function landedUnitCosts(lines: Array<{ quantity: number; unitPrice: number; stocked: boolean }>, landed: number): number[] {
  const base = lines.reduce((t, l) => t + (l.stocked ? l.quantity * l.unitPrice : 0), 0);
  if (!(landed > 0) || !(base > 0)) return lines.map(l => l.unitPrice);
  const last = lines.map(l => l.stocked && l.quantity * l.unitPrice > 0).lastIndexOf(true);
  let spread = 0;
  return lines.map((l, i) => {
    if (!l.stocked || !(l.quantity > 0)) return l.unitPrice;
    const share = i === last ? landed - spread : Math.round((landed * l.quantity * l.unitPrice / base) * 100) / 100;
    spread += share;
    return Math.round((l.unitPrice + share / l.quantity) * 100) / 100;
  });
}
