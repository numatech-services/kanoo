/**
 * Go/No-Go d'un appel d'offres — grille pondérée, règles pures.
 *
 * Répondre coûte (dossier, caution, temps de l'équipe) : la grille oblige à
 * se poser les bonnes questions avant d'engager ces frais. Chaque critère est
 * noté de 0 à 5 ; certains sont pré-évalués à partir des données (délai,
 * pièces réunies, trésorerie disponible, passé avec l'organisme), la décision
 * reste à la direction.
 */

export type CriterionKey = "fit" | "capacity" | "finance" | "compliance" | "winChance" | "margin" | "lead";

export const CRITERIA: Array<{ key: CriterionKey; label: string; hint: string; weight: number }> = [
  { key: "fit", label: "Adéquation au métier", hint: "Compétences et références similaires à présenter.", weight: 3 },
  { key: "capacity", label: "Capacité d'exécution", hint: "Équipe, moyens et délais compatibles avec la charge actuelle.", weight: 2 },
  { key: "finance", label: "Capacité financière", hint: "Caution, préfinancement des travaux, délais de paiement de l'administration.", weight: 2 },
  { key: "compliance", label: "Conformité administrative", hint: "Pièces exigées réunies et à jour.", weight: 2 },
  { key: "winChance", label: "Chances de l'emporter", hint: "Concurrence, connaissance du maître d'ouvrage, position prix.", weight: 2 },
  { key: "margin", label: "Rentabilité attendue", hint: "Marge prévisible après pénalités, retenues et frais.", weight: 2 },
  { key: "lead", label: "Délai de préparation", hint: "Temps restant pour monter un dossier solide.", weight: 1 },
];

export type Scores = Partial<Record<CriterionKey, number>>;

/** Note globale sur 100. Un critère non noté compte pour 0 : il faut tout évaluer. */
export function goScore(scores: Scores): number {
  const max = CRITERIA.reduce((t, c) => t + c.weight * 5, 0);
  const got = CRITERIA.reduce((t, c) => t + c.weight * Math.min(5, Math.max(0, Number(scores[c.key] ?? 0))), 0);
  return Math.round((got / max) * 100);
}

export type GoDecision = "go" | "review" | "no_go";
/** Recommandation : Go dès 65, à arbitrer entre 45 et 65, No-Go en dessous — et No-Go si un critère éliminatoire est à 0 ou 1. */
export function recommend(scores: Scores): GoDecision {
  const blocking: CriterionKey[] = ["fit", "compliance", "finance"];
  if (blocking.some(k => scores[k] !== undefined && Number(scores[k]) <= 1)) return "no_go";
  const s = goScore(scores);
  return s >= 65 ? "go" : s >= 45 ? "review" : "no_go";
}

/** Pré-évaluations tirées des données ; la direction peut les corriger. */
export function suggestions(input: {
  daysLeft: number | null;
  requiredDocs: Array<{ provided: boolean }>;
  cash: number;
  estimatedAmount: number;
  history: { won: number; lost: number };
}): Scores & { reasons: Partial<Record<CriterionKey, string>> } {
  const reasons: Partial<Record<CriterionKey, string>> = {};
  const out: Scores = {};
  if (input.daysLeft !== null) {
    const d = input.daysLeft;
    out.lead = d >= 21 ? 5 : d >= 14 ? 4 : d >= 7 ? 3 : d >= 3 ? 2 : d >= 0 ? 1 : 0;
    reasons.lead = d < 0 ? "Date limite dépassée." : `${d} jour${d > 1 ? "s" : ""} avant le dépôt.`;
  }
  if (input.requiredDocs.length) {
    const ok = input.requiredDocs.filter(x => x.provided).length;
    out.compliance = Math.round((ok / input.requiredDocs.length) * 5);
    reasons.compliance = `${ok} pièce${ok > 1 ? "s" : ""} sur ${input.requiredDocs.length} réunie${ok > 1 ? "s" : ""}.`;
  }
  if (input.estimatedAmount > 0) {
    const r = input.cash / input.estimatedAmount;
    out.finance = r >= 0.3 ? 5 : r >= 0.2 ? 4 : r >= 0.1 ? 3 : r >= 0.05 ? 2 : 1;
    reasons.finance = `Trésorerie disponible : ${Math.round(r * 100)} % du montant estimé (caution et préfinancement en demandent souvent 10 à 30 %).`;
  }
  const { won, lost } = input.history;
  if (won + lost > 0) {
    out.winChance = won === 0 ? 2 : Math.min(5, 3 + Math.round((won / (won + lost)) * 2));
    reasons.winChance = `Avec cet organisme : ${won} gagné${won > 1 ? "s" : ""}, ${lost} perdu${lost > 1 ? "s" : ""}.`;
  }
  return { ...out, reasons };
}
