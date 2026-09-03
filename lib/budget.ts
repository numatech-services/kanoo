/**
 * Budget prévisionnel.
 *
 * Le module répond à une question simple et souvent mal posée : « où en
 * sommes-nous ? » Mal posée, parce que comparer trois mois de réalisé à un
 * budget annuel donne toujours l'impression d'être sous contrôle. La
 * comparaison n'a de sens que **contre la part du budget correspondant au
 * temps écoulé** — c'est le budget au prorata, et c'est la seule base honnête.
 *
 * Deuxième principe : les prévisions ne sont pas linéaires. Une entreprise de
 * BTP ne facture pas en août comme en novembre, une association encaisse ses
 * cotisations au premier trimestre. Un budget réparti en douzièmes égaux
 * produit une alerte tous les mois creux et un faux calme tous les mois
 * pleins.
 */

export type BudgetNature = "revenue" | "expense";

export type SpreadMode = "even" | "manual" | "seasonal";

export interface BudgetLine {
  /** Compte SYSCOHADA ou préfixe : « 60 » attrape tous les achats. */
  accountPrefix: string;
  label: string;
  nature: BudgetNature;
  /** Montant annuel prévu. */
  annualAmount: number;
  /**
   * Répartition mensuelle. Douze valeurs, en part du total (elles somment à 1).
   * Absente en mode `even`.
   */
  monthlyWeights?: number[];
  spread?: SpreadMode;
  notes?: string;
}

export interface ActualByAccount {
  /** Préfixe de compte, agrégé au niveau de la ligne budgétaire. */
  accountPrefix: string;
  /** Réalisé par mois, index 0 = janvier. */
  monthly: number[];
}

const EVEN = Array.from({ length: 12 }, () => 1 / 12);

/** Poids d'une ligne, normalisés : une somme différente de 1 fausserait tout. */
export function weightsOf(line: BudgetLine): number[] {
  if (!line.monthlyWeights || line.monthlyWeights.length !== 12) return EVEN;
  const total = line.monthlyWeights.reduce((s, w) => s + w, 0);
  if (total <= 0) return EVEN;
  return line.monthlyWeights.map(w => w / total);
}

/** Budget mensuel d'une ligne. */
export function monthlyBudget(line: BudgetLine): number[] {
  return weightsOf(line).map(w => Math.round(line.annualAmount * w));
}

/**
 * Part du budget correspondant au temps écoulé.
 *
 * `throughMonth` est l'index du dernier mois clos (0 = janvier). Comparer le
 * réalisé de mars au budget annuel donne 25 % de consommation et l'illusion
 * d'une marge confortable ; le comparer au budget de janvier à mars dit la
 * vérité.
 */
export function proratedBudget(line: BudgetLine, throughMonth: number): number {
  const months = monthlyBudget(line);
  return months.slice(0, Math.min(12, Math.max(0, throughMonth + 1)))
    .reduce((s, v) => s + v, 0);
}

export type LineVerdict =
  | "on_track"        // dans l'épure
  | "under"           // en dessous — bonne nouvelle pour une charge, pas pour un produit
  | "over"            // dépassement du prorata
  | "exhausted"       // l'enveloppe annuelle est déjà consommée
  | "no_budget";      // du réalisé sans ligne budgétaire

export interface LineResult {
  line: BudgetLine;
  /** Réalisé cumulé sur les mois clos. */
  actualToDate: number;
  /** Budget correspondant aux mêmes mois. */
  budgetToDate: number;
  /** Écart : réalisé − prorata. Positif = on dépense (ou encaisse) plus vite. */
  variance: number;
  variancePercent: number | null;
  /** Consommation de l'enveloppe annuelle. */
  consumedPercent: number | null;
  /**
   * Projection de fin d'exercice au rythme constaté.
   * `null` avant le premier mois clos : extrapoler sur zéro mois n'a pas de sens.
   */
  projection: number | null;
  verdict: LineVerdict;
  monthly: { budget: number[]; actual: number[] };
}

/**
 * Seuil de tolérance.
 *
 * Un écart de 3 % sur une ligne d'achats est du bruit ; l'annoncer chaque mois
 * apprend à ignorer les alertes, et celle qui compte passe avec les autres.
 */
export const TOLERANCE_PERCENT = 8;

export function evaluateLine(
  line: BudgetLine,
  actual: number[] | undefined,
  throughMonth: number
): LineResult {
  const monthlyB = monthlyBudget(line);
  const monthlyA = actual ?? Array.from({ length: 12 }, () => 0);

  const upTo = Math.min(12, Math.max(0, throughMonth + 1));
  const actualToDate = monthlyA.slice(0, upTo).reduce((s, v) => s + v, 0);
  const budgetToDate = monthlyB.slice(0, upTo).reduce((s, v) => s + v, 0);

  const variance = actualToDate - budgetToDate;
  const variancePercent = budgetToDate !== 0
    ? Math.round((variance / Math.abs(budgetToDate)) * 1000) / 10
    : null;
  const consumedPercent = line.annualAmount !== 0
    ? Math.round((actualToDate / Math.abs(line.annualAmount)) * 1000) / 10
    : null;

  // La projection suppose que le rythme se maintient — hypothèse fragile mais
  // explicite. Elle n'est proposée qu'à partir d'un mois clos.
  const projection = upTo > 0 && budgetToDate > 0
    ? Math.round(actualToDate * (line.annualAmount / budgetToDate))
    : null;

  let verdict: LineVerdict;
  if (line.annualAmount === 0) {
    verdict = actualToDate !== 0 ? "no_budget" : "on_track";
  } else if (Math.abs(actualToDate) >= Math.abs(line.annualAmount)) {
    verdict = "exhausted";
  } else if (variancePercent === null || Math.abs(variancePercent) <= TOLERANCE_PERCENT) {
    verdict = "on_track";
  } else {
    verdict = variance > 0 ? "over" : "under";
  }

  return {
    line, actualToDate, budgetToDate, variance, variancePercent, consumedPercent,
    projection, verdict,
    monthly: { budget: monthlyB, actual: monthlyA },
  };
}

/**
 * Le verdict se lit différemment selon la nature.
 *
 * Dépasser une ligne de charges est une mauvaise nouvelle ; dépasser une ligne
 * de produits en est une bonne. Un tableau qui peint les deux en rouge apprend
 * à ne plus regarder les couleurs.
 */
export function isFavourable(result: LineResult): boolean | null {
  if (result.verdict === "on_track") return null;
  if (result.verdict === "no_budget") return false;
  const over = result.verdict === "over" || result.verdict === "exhausted";
  return result.line.nature === "revenue" ? over : !over;
}

export const VERDICT_LABEL: Record<LineVerdict, string> = {
  on_track: "Dans l'épure",
  under: "En deçà",
  over: "Au-delà",
  exhausted: "Enveloppe consommée",
  no_budget: "Hors budget",
};

export interface BudgetSummary {
  throughMonth: number;
  revenueBudget: number;
  revenueActual: number;
  expenseBudget: number;
  expenseActual: number;
  /** Résultat prévu et constaté, sur les mois clos. */
  plannedResult: number;
  actualResult: number;
  /** Projection du résultat à fin d'exercice, au rythme constaté. */
  projectedResult: number | null;
  linesOverBudget: number;
  linesExhausted: number;
  offBudgetAmount: number;
}

export function summarize(results: LineResult[], throughMonth: number): BudgetSummary {
  const summary: BudgetSummary = {
    throughMonth,
    revenueBudget: 0, revenueActual: 0,
    expenseBudget: 0, expenseActual: 0,
    plannedResult: 0, actualResult: 0, projectedResult: null,
    linesOverBudget: 0, linesExhausted: 0, offBudgetAmount: 0,
  };

  let projectedRevenue = 0;
  let projectedExpense = 0;
  let projectable = false;

  for (const result of results) {
    const revenue = result.line.nature === "revenue";
    if (revenue) {
      summary.revenueBudget += result.budgetToDate;
      summary.revenueActual += result.actualToDate;
      if (result.projection !== null) { projectedRevenue += result.projection; projectable = true; }
    } else {
      summary.expenseBudget += result.budgetToDate;
      summary.expenseActual += result.actualToDate;
      if (result.projection !== null) { projectedExpense += result.projection; projectable = true; }
    }

    if (result.verdict === "exhausted") summary.linesExhausted++;
    else if (result.verdict === "over" && !isFavourable(result)) summary.linesOverBudget++;
    if (result.verdict === "no_budget") summary.offBudgetAmount += result.actualToDate;
  }

  summary.plannedResult = summary.revenueBudget - summary.expenseBudget;
  summary.actualResult = summary.revenueActual - summary.expenseActual;
  summary.projectedResult = projectable ? projectedRevenue - projectedExpense : null;

  return summary;
}

/**
 * Phrase de synthèse.
 *
 * Elle dit ce qu'il faut retenir avant les colonnes. « Résultat de 2 400 000
 * contre 1 900 000 prévus » se comprend en une seconde ; un tableau de trente
 * lignes demande cinq minutes qu'on ne prend pas.
 */
export function headline(summary: BudgetSummary, monthNames: string[]): string {
  const xof = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} XOF`;
  const month = monthNames[Math.min(11, Math.max(0, summary.throughMonth))];
  const gap = summary.actualResult - summary.plannedResult;

  if (summary.revenueActual === 0 && summary.expenseActual === 0) {
    return `Aucun mouvement enregistré à fin ${month}.`;
  }

  const base = `À fin ${month}, résultat de ${xof(summary.actualResult)} `
    + `pour ${xof(summary.plannedResult)} prévus`;

  if (Math.abs(gap) < Math.abs(summary.plannedResult) * 0.05) {
    return `${base} — conforme à la prévision.`;
  }
  return gap > 0
    ? `${base}, soit ${xof(gap)} de mieux qu'attendu.`
    : `${base}, soit ${xof(-gap)} de moins qu'attendu.`;
}

/** Répartitions saisonnières usuelles, à ajuster. */
export const SEASONAL_PROFILES: Record<string, { label: string; weights: number[] }> = {
  even: {
    label: "Régulier (douzièmes)",
    weights: EVEN,
  },
  first_quarter: {
    label: "Concentré en début d'année",
    // Cotisations d'association, abonnements annuels.
    weights: [0.25, 0.20, 0.15, 0.06, 0.05, 0.05, 0.04, 0.03, 0.05, 0.05, 0.04, 0.03],
  },
  dry_season: {
    label: "Saison sèche (novembre à mai)",
    // BTP, travaux publics : l'hivernage arrête les chantiers.
    weights: [0.13, 0.13, 0.12, 0.10, 0.08, 0.03, 0.02, 0.02, 0.04, 0.10, 0.11, 0.12],
  },
  year_end: {
    label: "Concentré en fin d'année",
    weights: [0.04, 0.04, 0.05, 0.05, 0.06, 0.06, 0.07, 0.07, 0.09, 0.11, 0.15, 0.21],
  },
};
