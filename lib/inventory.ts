/**
 * Inventaire physique.
 *
 * Compter le stock, comparer au théorique, expliquer l'écart, puis l'écrire en
 * comptabilité. Trois principes portent tout le module :
 *
 * 1. **Le comptage est aveugle par défaut.** Montrer la quantité théorique au
 *    compteur ne produit pas un inventaire, mais une confirmation : devant
 *    « théorique 48 », on compte 48. L'écart réel disparaît, et avec lui la
 *    seule raison de faire l'inventaire.
 * 2. **Le théorique est figé à l'ouverture.** Sans photographie, une vente
 *    saisie pendant le comptage transforme un stock juste en écart, et un
 *    écart réel en stock juste.
 * 3. **L'écart se valorise au coût, jamais au prix de vente.** Un manquant
 *    valorisé au prix de vente compte comme perdue une marge qui n'a jamais
 *    été gagnée : l'écart est surévalué de bout en bout.
 */

export type CountStatus = "draft" | "counting" | "review" | "validated" | "cancelled";

export const COUNT_STATUS_LABEL: Record<CountStatus, string> = {
  draft: "Préparation",
  counting: "Comptage en cours",
  review: "Écarts à valider",
  validated: "Validé",
  cancelled: "Annulé",
};

export interface CountLine {
  productId: string;
  code: string;
  label: string;
  unit?: string;
  /** Quantité au système, figée à l'ouverture de la session. */
  theoreticalQty: number;
  /** Quantité comptée. `null` tant que la ligne n'a pas été relevée. */
  countedQty?: number | null;
  /** Second comptage, demandé sur les écarts notables. */
  recountQty?: number | null;
  /** Coût unitaire retenu pour la valorisation. `null` = non valorisable. */
  unitCost?: number | null;
  reason?: string;
  countedBy?: string;
  countedAt?: Date | string;
}

export interface LineResult {
  counted: boolean;
  /** Quantité retenue : le recomptage prime sur le premier passage. */
  finalQty: number | null;
  /** Écart en quantité. Positif = trouvé en plus. */
  variance: number | null;
  /** Écart en valeur. `null` quand aucun coût n'est connu. */
  varianceValue: number | null;
  /** Écart relatif au théorique, pour trier par gravité. */
  variancePercent: number | null;
  /** Un second comptage est-il justifié ? */
  needsRecount: boolean;
  /** L'écart doit-il être expliqué avant validation ? */
  needsReason: boolean;
}

export interface CountPolicy {
  /**
   * Écart en quantité au-delà duquel un second comptage est demandé.
   * Un écart d'une unité sur trois cents est du bruit ; un écart de trente
   * est soit une erreur de comptage, soit un vol — dans les deux cas on
   * recompte avant d'écrire quoi que ce soit en comptabilité.
   */
  recountThresholdQty: number;
  /** Ou, en pourcentage du théorique. Le premier des deux atteint suffit. */
  recountThresholdPercent: number;
  /** Valeur d'écart au-delà de laquelle un motif est exigé. */
  reasonThresholdValue: number;
  /** Le comptage est-il aveugle ? */
  blind: boolean;
}

export const DEFAULT_COUNT_POLICY: CountPolicy = {
  recountThresholdQty: 10,
  recountThresholdPercent: 10,
  reasonThresholdValue: 50_000,
  blind: true,
};

/**
 * Coût unitaire moyen pondéré, dérivé des entrées.
 *
 * Le modèle Produit ne porte qu'un prix de vente. Le coût se reconstitue donc
 * à partir des mouvements d'entrée valorisés — c'est le CUMP, la méthode
 * retenue par le SYSCOHADA. Sans historique d'entrée valorisée, on ne devine
 * pas : la ligne est marquée non valorisable et l'écran le dit, plutôt que de
 * produire un montant faux qui finirait dans une écriture.
 */
export function weightedAverageCost(
  entries: Array<{ quantity: number; unitCost?: number }>
): number | null {
  let value = 0;
  let quantity = 0;
  for (const entry of entries) {
    if (entry.quantity <= 0 || !entry.unitCost || entry.unitCost <= 0) continue;
    value += entry.quantity * entry.unitCost;
    quantity += entry.quantity;
  }
  return quantity > 0 ? Math.round(value / quantity) : null;
}

export function evaluateLine(line: CountLine, policy: CountPolicy): LineResult {
  const finalQty = line.recountQty ?? line.countedQty ?? null;

  if (finalQty === null || finalQty === undefined) {
    return {
      counted: false, finalQty: null, variance: null, varianceValue: null,
      variancePercent: null, needsRecount: false, needsReason: false,
    };
  }

  const variance = finalQty - line.theoreticalQty;
  const varianceValue = line.unitCost != null ? Math.round(variance * line.unitCost) : null;
  const variancePercent = line.theoreticalQty !== 0
    ? (variance / Math.abs(line.theoreticalQty)) * 100
    : (variance !== 0 ? 100 : 0);

  // Le recomptage ne se demande qu'après un premier passage : si le second est
  // déjà fait, la question est tranchée.
  const alreadyRecounted = line.recountQty !== null && line.recountQty !== undefined;
  const needsRecount = !alreadyRecounted && (
    Math.abs(variance) >= policy.recountThresholdQty
    || Math.abs(variancePercent) >= policy.recountThresholdPercent
  ) && variance !== 0;

  const needsReason = variance !== 0
    && !line.reason?.trim()
    && (varianceValue === null || Math.abs(varianceValue) >= policy.reasonThresholdValue);

  return {
    counted: true, finalQty, variance, varianceValue, variancePercent,
    needsRecount, needsReason,
  };
}

export interface CountSummary {
  lines: number;
  counted: number;
  pending: number;
  withVariance: number;
  needingRecount: number;
  needingReason: number;
  /** Somme des écarts positifs et négatifs, en valeur. */
  surplusValue: number;
  shortageValue: number;
  netValue: number;
  /** Lignes dont l'écart n'a pas pu être valorisé. */
  unvaluedLines: number;
  /** Taux de fiabilité : part des lignes sans écart. */
  accuracy: number | null;
}

export function summarizeCount(lines: CountLine[], policy: CountPolicy): CountSummary {
  const summary: CountSummary = {
    lines: lines.length, counted: 0, pending: 0, withVariance: 0,
    needingRecount: 0, needingReason: 0,
    surplusValue: 0, shortageValue: 0, netValue: 0,
    unvaluedLines: 0, accuracy: null,
  };

  for (const line of lines) {
    const result = evaluateLine(line, policy);
    if (!result.counted) { summary.pending++; continue; }

    summary.counted++;
    if (result.variance !== 0) {
      summary.withVariance++;
      if (result.varianceValue === null) summary.unvaluedLines++;
      else if (result.varianceValue > 0) summary.surplusValue += result.varianceValue;
      else summary.shortageValue += Math.abs(result.varianceValue);
    }
    if (result.needsRecount) summary.needingRecount++;
    if (result.needsReason) summary.needingReason++;
  }

  summary.netValue = summary.surplusValue - summary.shortageValue;
  // La fiabilité se mesure sur ce qui a été compté : l'annoncer sur le total
  // ferait passer un inventaire à moitié fait pour un inventaire à moitié faux.
  summary.accuracy = summary.counted > 0
    ? Math.round(((summary.counted - summary.withVariance) / summary.counted) * 1000) / 10
    : null;

  return summary;
}

export type BlockReason =
  | "nothing_counted" | "lines_pending" | "recount_required" | "reason_required";

export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  nothing_counted: "Aucune ligne n'a été comptée.",
  lines_pending: "Des lignes n'ont pas été relevées. Une ligne non comptée n'est pas une ligne à zéro : validez-la à zéro si le stock est vide, sinon comptez-la.",
  recount_required: "Des écarts importants attendent un second comptage. Un écart de cette taille est soit une erreur de relevé, soit une perte réelle — l'un et l'autre méritent d'être vérifiés avant l'écriture.",
  reason_required: "Des écarts de valeur significative sont sans explication. Une régularisation sans motif est incontestable au moment où l'on en aurait besoin.",
};

/** Ce qui empêche de valider. Vide = l'inventaire peut être écrit. */
export function validationBlockers(lines: CountLine[], policy: CountPolicy): BlockReason[] {
  const summary = summarizeCount(lines, policy);
  const blockers: BlockReason[] = [];

  if (summary.counted === 0) blockers.push("nothing_counted");
  if (summary.pending > 0) blockers.push("lines_pending");
  if (summary.needingRecount > 0) blockers.push("recount_required");
  if (summary.needingReason > 0) blockers.push("reason_required");

  return blockers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Écriture comptable
// ─────────────────────────────────────────────────────────────────────────────

export interface EntryLine {
  accountCode: string;
  accountLabel: string;
  debit: number;
  credit: number;
}

/** Comptes SYSCOHADA de la régularisation d'inventaire. */
export const INVENTORY_ACCOUNTS = {
  stock: { account: "311000", label: "Marchandises" },
  shortage: { account: "659000", label: "Charges provisionnées d'exploitation — manquants d'inventaire" },
  surplus: { account: "759000", label: "Reprises de charges provisionnées — excédents d'inventaire" },
};

/**
 * Écriture de régularisation.
 *
 * Un manquant diminue le stock et charge le résultat ; un excédent
 * l'augmente et le crédite. Les deux sens coexistent dans un même inventaire
 * et **ne se compensent pas** : compenser masquerait un vol de trente unités
 * derrière une erreur de saisie de trente autres.
 */
export function adjustmentEntry(lines: CountLine[], policy: CountPolicy): EntryLine[] {
  let shortage = 0;
  let surplus = 0;

  for (const line of lines) {
    const result = evaluateLine(line, policy);
    if (!result.counted || result.varianceValue === null || result.varianceValue === 0) continue;
    if (result.varianceValue > 0) surplus += result.varianceValue;
    else shortage += Math.abs(result.varianceValue);
  }

  const entry: EntryLine[] = [];

  if (shortage > 0) {
    entry.push({ accountCode: INVENTORY_ACCOUNTS.shortage.account, accountLabel: INVENTORY_ACCOUNTS.shortage.label, debit: shortage, credit: 0 });
    entry.push({ accountCode: INVENTORY_ACCOUNTS.stock.account, accountLabel: INVENTORY_ACCOUNTS.stock.label, debit: 0, credit: shortage });
  }
  if (surplus > 0) {
    entry.push({ accountCode: INVENTORY_ACCOUNTS.stock.account, accountLabel: INVENTORY_ACCOUNTS.stock.label, debit: surplus, credit: 0 });
    entry.push({ accountCode: INVENTORY_ACCOUNTS.surplus.account, accountLabel: INVENTORY_ACCOUNTS.surplus.label, debit: 0, credit: surplus });
  }

  return entry;
}

export function isBalanced(entry: EntryLine[]): boolean {
  const debit = entry.reduce((s, l) => s + l.debit, 0);
  const credit = entry.reduce((s, l) => s + l.credit, 0);
  return debit === credit;
}

/** Les écarts les plus lourds d'abord — c'est par là qu'on commence l'enquête. */
export function rankVariances(lines: CountLine[], policy: CountPolicy, limit = 10) {
  return lines
    .map(line => ({ line, result: evaluateLine(line, policy) }))
    .filter(({ result }) => result.counted && result.variance !== 0)
    .sort((a, b) =>
      Math.abs(b.result.varianceValue ?? 0) - Math.abs(a.result.varianceValue ?? 0)
      || Math.abs(b.result.variance ?? 0) - Math.abs(a.result.variance ?? 0)
    )
    .slice(0, limit);
}
