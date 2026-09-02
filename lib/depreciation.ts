/**
 * Moteur de calcul des amortissements — Kanoo Niger (OHADA)
 * Méthodes : linéaire et dégressif
 */

export interface DepreciationEntry {
  year: number;
  annuity: number;
  cumulative: number;
  netValue: number;
}

export interface DepreciationPlan {
  method: "linear" | "degressive";
  acquisitionCost: number;
  residualValue: number;
  usefulLifeYears: number;
  annualRate: number;
  schedule: DepreciationEntry[];
  totalDepreciation: number;
}

/**
 * Construit un échéancier linéaire, **prorata temporis**.
 *
 * OHADA fait courir l'amortissement à compter de la mise en service : un bien
 * mis en service le 1er octobre ne supporte que trois douzièmes d'annuité la
 * première année, et le reliquat se reporte sur un exercice supplémentaire.
 *
 * Implémentation unique du calcul : `niger-fiscal.ts` en portait une seconde,
 * divergente, et c'était celle qu'utilisait la route des immobilisations.
 *
 * @param serviceDate Date de mise en service. Absente, l'annuité de la première
 *   année est pleine (comportement d'avant le prorata).
 */
export function buildLinearSchedule(
  acquisitionCost: number,
  residualValue: number,
  usefulLifeYears: number,
  acquisitionYear: number,
  serviceDate?: Date
): DepreciationEntry[] {
  if (usefulLifeYears <= 0) return [];

  const base = acquisitionCost - residualValue;
  const fullAnnuity = base / usefulLifeYears;

  // Base 12 mois, le mois de mise en service compté en entier.
  const firstYearFraction = serviceDate ? (12 - serviceDate.getMonth()) / 12 : 1;
  const spanYears = firstYearFraction < 1 ? usefulLifeYears + 1 : usefulLifeYears;

  const schedule: DepreciationEntry[] = [];
  let cumulative = 0;
  let remaining = base;

  for (let i = 0; i < spanYears && remaining > 0; i++) {
    const isLast = i === spanYears - 1;
    const raw = i === 0 ? fullAnnuity * firstYearFraction : fullAnnuity;
    // La dernière annuité absorbe les arrondis et solde exactement la base.
    const yearAnnuity = isLast ? remaining : Math.min(Math.round(raw), remaining);

    cumulative += yearAnnuity;
    remaining -= yearAnnuity;
    schedule.push({
      year: acquisitionYear + i,
      annuity: yearAnnuity,
      cumulative,
      netValue: Math.max(0, acquisitionCost - cumulative),
    });
  }
  return schedule;
}

/**
 * Plan d'amortissement linéaire complet.
 * Taux = 100% / durée de vie
 */
export function calculerAmortissementLineaire(
  acquisitionCost: number,
  residualValue = 0,
  usefulLifeYears: number,
  acquisitionYear: number,
  serviceDate?: Date
): DepreciationPlan {
  const annualRate = usefulLifeYears > 0 ? 1 / usefulLifeYears : 0;
  const schedule = buildLinearSchedule(
    acquisitionCost, residualValue, usefulLifeYears, acquisitionYear, serviceDate
  );

  return {
    method: "linear",
    acquisitionCost,
    residualValue,
    usefulLifeYears,
    annualRate,
    schedule,
    // Somme réellement dotée par l'échéancier — pas une base théorique.
    totalDepreciation: schedule.reduce((sum, e) => sum + e.annuity, 0),
  };
}

/**
 * Calcule un plan d'amortissement dégressif (méthode fiscale Niger)
 * Taux dégressif = taux linéaire × coefficient (1,5 / 2 / 2,5 selon durée)
 */
export function calculerAmortissementDegressif(
  acquisitionCost: number,
  residualValue = 0,
  usefulLifeYears: number,
  acquisitionYear: number,
  customRate?: number
): DepreciationPlan {
  // Coefficients OHADA selon durée de vie
  let coefficient = 1.5;
  if (usefulLifeYears >= 5 && usefulLifeYears < 7) coefficient = 2;
  if (usefulLifeYears >= 7) coefficient = 2.5;

  const linearRate = 1 / usefulLifeYears;
  const degressiveRate = customRate || linearRate * coefficient;

  const schedule: DepreciationEntry[] = [];
  let netValue = acquisitionCost;
  let cumulative = 0;

  for (let i = 0; i < usefulLifeYears; i++) {
    const remainingYears = usefulLifeYears - i;
    const linearRateRemaining = 1 / remainingYears;

    // Basculer en linéaire quand plus avantageux
    const degressiveAnnuity = Math.round(netValue * degressiveRate);
    const linearAnnuity = Math.round((netValue - residualValue) * linearRateRemaining);
    const annuity = Math.max(degressiveAnnuity, linearAnnuity);

    const isLast = i === usefulLifeYears - 1;
    const yearAnnuity = isLast ? netValue - residualValue : Math.min(annuity, netValue - residualValue);

    cumulative += yearAnnuity;
    netValue -= yearAnnuity;

    schedule.push({
      year: acquisitionYear + i,
      annuity: yearAnnuity,
      cumulative,
      netValue: Math.max(residualValue, netValue),
    });
  }

  return {
    method: "degressive",
    acquisitionCost,
    residualValue,
    usefulLifeYears,
    annualRate: degressiveRate,
    schedule,
    totalDepreciation: acquisitionCost - residualValue,
  };
}

/**
 * Durées de vie usuelles par catégorie (OHADA / pratique Niger)
 */
export const USEFUL_LIFE: Record<string, { years: number; label: string; accountCode: string }> = {
  building:   { years: 20, label: "Immeubles et constructions",    accountCode: "231" },
  equipment:  { years: 10, label: "Matériels et outillages",       accountCode: "245" },
  vehicle:    { years: 5,  label: "Véhicules de transport",        accountCode: "244" },
  furniture:  { years: 10, label: "Mobilier de bureau",            accountCode: "244" },
  computer:   { years: 3,  label: "Matériel informatique",         accountCode: "246" },
  software:   { years: 3,  label: "Logiciels",                     accountCode: "211" },
  land:       { years: 0,  label: "Terrains (non amortissable)",   accountCode: "221" },
  other:      { years: 5,  label: "Autres immobilisations",        accountCode: "248" },
};
