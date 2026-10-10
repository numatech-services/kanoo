/**
 * Catégories de dépenses d'un marché, déduites du compte de charge (plan
 * SYSCOHADA) : aucune saisie supplémentaire, et la même lecture que la
 * comptabilité. Sans dépendance serveur : utilisable côté client.
 */
export const COST_CATEGORIES = [
  { key: "registration", label: "Enregistrement, impôts et taxes", hint: "Droits d'enregistrement du marché, timbres, taxes (64)", rx: /^64/ },
  { key: "materials", label: "Matières premières et achats", hint: "Matières, fournitures, marchandises (60)", rx: /^60/ },
  { key: "transport", label: "Transport", hint: "Transports sur achats et de personnel (61)", rx: /^61/ },
  { key: "services", label: "Sous-traitance et services", hint: "Sous-traitance, locations, honoraires, entretien (62, 63)", rx: /^6[23]/ },
  { key: "personnel", label: "Personnel", hint: "Salaires et charges imputés (66)", rx: /^66/ },
  { key: "other", label: "Autres dépenses", hint: "Toute autre charge (6x)", rx: /^6/ },
] as const;

export type CostCategoryKey = (typeof COST_CATEGORIES)[number]["key"];

export function costCategory(accountCode: string): CostCategoryKey {
  return (COST_CATEGORIES.find(c => c.rx.test(accountCode)) ?? COST_CATEGORIES[COST_CATEGORIES.length - 1]).key;
}
