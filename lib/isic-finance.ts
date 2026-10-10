/**
 * Rentabilité d'un lot ISIC, sans dépendance serveur (utilisable à l'écran).
 *
 * Prévu : licences (cartes × coût licence), impression et tours de cou
 * (cartes × coût unitaire prévu), frais opérationnels et autres tels que
 * saisis. Réel : licences effectivement réglées à ISIC, puis chaque dépense
 * saisie dans sa catégorie. Une catégorie sans dépense réelle reprend le
 * prévu dans la marge à terminaison.
 */
export type IsicCostKey = "license" | "printing" | "lanyard" | "operations" | "other";

export const ISIC_COST_LABEL: Record<IsicCostKey, string> = {
  license: "Licences ISIC",
  printing: "Impression des cartes",
  lanyard: "Tours de cou personnalisés",
  operations: "Frais opérationnels",
  other: "Autres dépenses",
};

export interface IsicBatchLike {
  totalCards: number; unitLicenseFee?: number; unitSalePrice?: number; unitPrintCost?: number; unitLanyardCost?: number;
  costs?: Array<{ category: string; amount: number }>;
  licensePayments?: Array<{ amount: number }>;
}

export function isicBatchFinance(b: IsicBatchLike) {
  const n = b.totalCards || 0;
  const sale = n * (b.unitSalePrice || 0);
  const spent = (cat: string) => (b.costs ?? []).filter(c => c.category === cat).reduce((t, c) => t + (c.amount || 0), 0);
  const planned: Record<IsicCostKey, number> = {
    license: n * (b.unitLicenseFee || 0),
    printing: n * (b.unitPrintCost || 0),
    lanyard: n * (b.unitLanyardCost || 0),
    operations: spent("operations"),
    other: spent("other"),
  };
  const actual: Record<IsicCostKey, number> = {
    license: (b.licensePayments ?? []).reduce((t, p) => t + (p.amount || 0), 0),
    printing: spent("printing"),
    lanyard: spent("lanyard"),
    operations: spent("operations"),
    other: spent("other"),
  };
  const keys = Object.keys(ISIC_COST_LABEL) as IsicCostKey[];
  const sum = (r: Record<IsicCostKey, number>) => keys.reduce((t, k) => t + r[k], 0);
  // À terminaison : le réel quand il existe, le prévu sinon.
  const forecast = keys.reduce((t, k) => t + Math.max(actual[k], planned[k]), 0);
  const plannedTotal = sum(planned), actualTotal = sum(actual);
  return {
    sale, planned, actual, plannedTotal, actualTotal,
    plannedMargin: sale - plannedTotal,
    forecastMargin: sale - forecast,
    unitCostPlanned: n ? Math.round(plannedTotal / n) : 0,
    unitCostForecast: n ? Math.round(forecast / n) : 0,
    unitMarginForecast: n ? Math.round((sale - forecast) / n) : 0,
    marginRate: sale > 0 ? Math.round(((sale - forecast) / sale) * 1000) / 10 : null,
  };
}
