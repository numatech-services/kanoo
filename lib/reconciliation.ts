/**
 * Rapprochement bancaire.
 *
 * Deux séries à confronter : ce que Kanoo a enregistré (mouvements) et ce que
 * la banque déclare (lignes de relevé). Le rapprochement les apparie ; l'écart
 * qui subsiste est l'information utile.
 *
 * Fonctions pures : ni base, ni horloge — la date d'appréciation est toujours
 * un paramètre. C'est ce qui rend un appariement reproductible et vérifiable
 * par un test plutôt que par une capture d'écran.
 */

import crypto from "crypto";

export interface MovementLike {
  _id: unknown;
  date: Date | string;
  /** Signé : entrée positive, sortie négative. */
  amount: number;
  label: string;
  reference?: string;
  statementLineId?: unknown;
}

export interface StatementLineLike {
  _id: unknown;
  date: Date | string;
  amount: number;
  label: string;
  reference?: string;
  movementId?: unknown;
  ignoredAt?: Date | string | null;
}

const DAY = 86_400_000;

function toTime(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

/** Normalise un libellé pour la comparaison : sans accent, sans ponctuation. */
export function normalizeLabel(value: string): string {
  return (value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Empreinte d'une ligne de relevé, pour refuser un import en double.
 *
 * Deux lignes réellement identiques le même jour — deux retraits de 10 000 au
 * même distributeur — produiraient la même empreinte. L'index d'unicité en
 * rejetterait la seconde à tort ; le rang parmi les lignes identiques du
 * fichier est donc inclus (0 pour la première, 1 pour la deuxième…).
 */
export function lineFingerprint(
  accountId: string,
  date: Date | string,
  amount: number,
  label: string,
  rank: number
): string {
  const day = new Date(toTime(date)).toISOString().slice(0, 10);
  return crypto
    .createHash("sha256")
    .update(`${accountId}|${day}|${amount}|${normalizeLabel(label)}|${rank}`)
    .digest("hex")
    .slice(0, 32);
}

// ─────────────────────────────────────────────────────────────────────────────
// Appariement
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchSuggestion {
  movementId: unknown;
  lineId: unknown;
  /** 0 à 100. Au-delà de 90, l'appariement peut être proposé coché. */
  score: number;
  reasons: string[];
}

/** Fenêtre de tolérance : une opération met quelques jours à figurer au relevé. */
const DATE_TOLERANCE_DAYS = 5;

/**
 * Score d'appariement entre un mouvement et une ligne de relevé.
 *
 * Le montant est éliminatoire : deux opérations de montants différents ne sont
 * jamais la même, quelle que soit la ressemblance des libellés. Le reste —
 * proximité de date, référence commune, mots partagés — ne fait que départager
 * des candidats de même montant.
 */
export function matchScore(movement: MovementLike, line: StatementLineLike): MatchSuggestion | null {
  if (movement.amount !== line.amount) return null;

  const days = Math.abs(toTime(movement.date) - toTime(line.date)) / DAY;
  if (days > DATE_TOLERANCE_DAYS) return null;

  const reasons: string[] = ["Montant identique"];
  // Base à 60 : le seul montant identique dans la fenêtre est déjà un indice
  // sérieux, mais jamais suffisant pour rapprocher sans regarder.
  let score = 60;

  if (days === 0) { score += 20; reasons.push("Même date"); }
  else if (days <= 2) { score += 12; reasons.push(`${Math.round(days)} jour(s) d'écart`); }
  else { score += 4; reasons.push(`${Math.round(days)} jours d'écart`); }

  const movementRef = normalizeLabel(movement.reference || "");
  const lineText = normalizeLabel(`${line.label} ${line.reference || ""}`);
  if (movementRef && lineText.includes(movementRef)) {
    score += 20;
    reasons.push("Référence retrouvée au relevé");
  }

  // Mots significatifs communs : un nom de client, un numéro de facture.
  const movementWords = new Set(
    normalizeLabel(movement.label).split(" ").filter(w => w.length >= 4)
  );
  const shared = [...movementWords].filter(w => lineText.includes(w));
  if (shared.length > 0) {
    score += Math.min(15, shared.length * 8);
    reasons.push(`Libellé commun : ${shared.slice(0, 2).join(", ")}`);
  }

  return { movementId: movement._id, lineId: line._id, score: Math.min(100, score), reasons };
}

/**
 * Propose des appariements entre mouvements et lignes non encore rapprochés.
 *
 * Chaque mouvement et chaque ligne n'apparaissent qu'une fois : les meilleures
 * paires sont retenues d'abord, et les éléments consommés retirés. Sans cela,
 * un même encaissement serait proposé pour trois lignes de même montant et le
 * comptable devrait défaire.
 */
export function suggestMatches(
  movements: MovementLike[],
  lines: StatementLineLike[]
): MatchSuggestion[] {
  const openMovements = movements.filter(m => !m.statementLineId);
  const openLines = lines.filter(l => !l.movementId && !l.ignoredAt);

  const candidates: MatchSuggestion[] = [];
  for (const movement of openMovements) {
    for (const line of openLines) {
      const match = matchScore(movement, line);
      if (match) candidates.push(match);
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedMovements = new Set<string>();
  const usedLines = new Set<string>();
  const retained: MatchSuggestion[] = [];

  for (const candidate of candidates) {
    const m = String(candidate.movementId);
    const l = String(candidate.lineId);
    if (usedMovements.has(m) || usedLines.has(l)) continue;
    usedMovements.add(m);
    usedLines.add(l);
    retained.push(candidate);
  }

  return retained;
}

// ─────────────────────────────────────────────────────────────────────────────
// Soldes et écarts
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationSummary {
  /** Solde d'ouverture déclaré sur le compte. */
  openingBalance: number;
  /** Solde d'après les mouvements Kanoo, à la date d'arrêté. */
  bookBalance: number;
  /** Solde d'après le relevé bancaire, à la même date. */
  bankBalance: number;
  /** Écart entre les deux. Zéro signifie que le compte est rapproché. */
  gap: number;

  movementsTotal: number;
  movementsReconciled: number;
  movementsPending: number;
  /** Montant des mouvements non encore vus par la banque. */
  pendingAmount: number;

  linesTotal: number;
  linesReconciled: number;
  linesPending: number;
  /** Montant des lignes de relevé qu'aucun mouvement n'explique. */
  unexplainedAmount: number;
}

/**
 * Établit la situation d'un compte à une date d'arrêté.
 *
 * `asOf` borne les deux séries : rapprocher au 31 janvier des mouvements de
 * février donnerait un écart qui n'existe pas.
 */
export function reconciliationSummary(
  openingBalance: number,
  movements: MovementLike[],
  lines: StatementLineLike[],
  asOf: Date = new Date()
): ReconciliationSummary {
  const limit = asOf.getTime();
  const inScopeMovements = movements.filter(m => toTime(m.date) <= limit);
  const inScopeLines = lines.filter(l => toTime(l.date) <= limit && !l.ignoredAt);

  const movementsSum = inScopeMovements.reduce((s, m) => s + m.amount, 0);
  const linesSum = inScopeLines.reduce((s, l) => s + l.amount, 0);

  const reconciledMovements = inScopeMovements.filter(m => m.statementLineId);
  const pendingMovements = inScopeMovements.filter(m => !m.statementLineId);
  const reconciledLines = inScopeLines.filter(l => l.movementId);
  const pendingLines = inScopeLines.filter(l => !l.movementId);

  const bookBalance = openingBalance + movementsSum;
  const bankBalance = openingBalance + linesSum;

  return {
    openingBalance,
    bookBalance,
    bankBalance,
    gap: bookBalance - bankBalance,
    movementsTotal: inScopeMovements.length,
    movementsReconciled: reconciledMovements.length,
    movementsPending: pendingMovements.length,
    pendingAmount: pendingMovements.reduce((s, m) => s + m.amount, 0),
    linesTotal: inScopeLines.length,
    linesReconciled: reconciledLines.length,
    linesPending: pendingLines.length,
    unexplainedAmount: pendingLines.reduce((s, l) => s + l.amount, 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import CSV
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedStatementLine {
  date: Date;
  amount: number;
  label: string;
  reference?: string;
  /** Rang dans le fichier — départage deux lignes réellement identiques. */
  rank: number;
}

export interface ParseResult {
  lines: ParsedStatementLine[];
  /** Lignes écartées, avec la raison — jamais avalées en silence. */
  rejected: Array<{ row: number; raw: string; reason: string }>;
}

/** Sépare une ligne CSV en respectant les guillemets. */
function splitCsvRow(row: string, separator: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      // Deux guillemets consécutifs à l'intérieur d'un champ = un guillemet.
      if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === separator && !inQuotes) {
      cells.push(current); current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map(c => c.trim());
}

/**
 * Lit un montant écrit à la française ou à l'anglaise.
 * « 1 234,56 », « 1,234.56 », « -1234 » et « (1234) » donnent tous un nombre.
 */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  let text = raw.trim().replace(/\s| /g, "");

  // Parenthèses : convention comptable pour un montant négatif.
  const parenthesised = /^\((.*)\)$/.exec(text);
  if (parenthesised) text = `-${parenthesised[1]}`;

  text = text.replace(/[^\d,.\-+]/g, "");
  if (!text) return null;

  // Le FCFA n'a pas de centimes : un séparateur suivi d'exactement trois
  // chiffres est un séparateur de milliers, jamais une virgule décimale.
  // Lu autrement, « 150.000 » (format français) et « 150,000 » (export
  // anglais) donnaient 150 FCFA, et « 1.500.000 » était rejeté.
  // Seul un dernier séparateur suivi d'un ou deux chiffres est décimal.
  const lastSep = Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
  const decimals = lastSep >= 0 ? text.length - lastSep - 1 : 0;
  if (lastSep >= 0 && decimals >= 1 && decimals <= 2) {
    text = text.slice(0, lastSep).replace(/[.,]/g, "") + "." + text.slice(lastSep + 1);
  } else {
    text = text.replace(/[.,]/g, "");
  }

  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  // Le FCFA n'a pas de décimale : on arrondit au franc.
  return Math.round(value);
}

/** Lit une date en JJ/MM/AAAA, JJ-MM-AAAA ou AAAA-MM-JJ. */
export function parseStatementDate(raw: string): Date | null {
  if (!raw) return null;
  const text = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const fr = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(text);
  if (fr) {
    const year = Number(fr[3]);
    return new Date(year < 100 ? 2000 + year : year, Number(fr[2]) - 1, Number(fr[1]));
  }
  return null;
}

/**
 * Analyse un relevé au format CSV.
 *
 * Les banques n'exportent pas deux fichiers pareils : colonnes dans un ordre
 * variable, montant en une colonne signée ou en deux colonnes débit/crédit,
 * séparateur point-virgule ou virgule. Le format est donc décrit par l'appelant
 * plutôt que deviné — une détection automatique qui se trompe importe des
 * montants faux sans le dire.
 */
export function parseStatementCsv(
  content: string,
  mapping: {
    separator?: string;
    /** Index de colonne, base 0. */
    date: number;
    label: number;
    /** Colonne unique de montant signé. */
    amount?: number;
    /** Ou deux colonnes séparées : débit (sortie) et crédit (entrée). */
    debit?: number;
    credit?: number;
    reference?: number;
    /** Nombre de lignes d'en-tête à ignorer. */
    skipRows?: number;
  }
): ParseResult {
  const separator = mapping.separator || ";";
  const skip = mapping.skipRows ?? 1;

  const rows = content.split(/\r?\n/).filter(r => r.trim().length > 0);
  const lines: ParsedStatementLine[] = [];
  const rejected: ParseResult["rejected"] = [];
  // Rang parmi les lignes IDENTIQUES (même jour, montant, libellé), pas dans le
  // fichier : réimporter un relevé qui chevauche le précédent redonne la même
  // empreinte aux lignes communes, qui sont alors reconnues comme déjà
  // importées. Avec le rang dans le fichier, toutes les lignes communes
  // changeaient d'empreinte et étaient dupliquées.
  const seen = new Map<string, number>();

  rows.slice(skip).forEach((row, index) => {
    const rowNumber = index + skip + 1;
    const cells = splitCsvRow(row, separator);

    const date = parseStatementDate(cells[mapping.date] ?? "");
    if (!date || Number.isNaN(date.getTime())) {
      rejected.push({ row: rowNumber, raw: row.slice(0, 120), reason: "Date illisible" });
      return;
    }

    let amount: number | null = null;
    if (mapping.amount !== undefined) {
      amount = parseAmount(cells[mapping.amount] ?? "");
    } else {
      const debit = parseAmount(cells[mapping.debit ?? -1] ?? "") ?? 0;
      const credit = parseAmount(cells[mapping.credit ?? -1] ?? "") ?? 0;
      // Un débit est une sortie : on lui donne son signe, même si la banque
      // l'exporte en valeur absolue dans une colonne dédiée.
      amount = credit - Math.abs(debit);
    }
    if (amount === null || amount === 0) {
      rejected.push({ row: rowNumber, raw: row.slice(0, 120), reason: "Montant illisible ou nul" });
      return;
    }

    const label = (cells[mapping.label] ?? "").trim();
    if (!label) {
      rejected.push({ row: rowNumber, raw: row.slice(0, 120), reason: "Libellé absent" });
      return;
    }

    lines.push({
      date,
      amount,
      label,
      reference: mapping.reference !== undefined ? cells[mapping.reference] || undefined : undefined,
      rank: (() => {
        const key = `${date.toDateString()}|${amount}|${normalizeLabel(label)}`;
        const r = seen.get(key) ?? 0;
        seen.set(key, r + 1);
        return r;
      })(),
    });
  });

  return { lines, rejected };
}
