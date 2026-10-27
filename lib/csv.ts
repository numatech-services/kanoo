/**
 * Cellules de CSV sûres à ouvrir dans un tableur.
 *
 * Un libellé saisi par un utilisateur (« =HYPERLINK(...) », « +cmd|... »,
 * « @SUM(...) ») était exporté tel quel : Excel ou LibreOffice l'exécutent à
 * l'ouverture du fichier par le comptable (injection de formule). La parade
 * usuelle : préfixer d'une apostrophe tout texte commençant par = + - @,
 * tabulation ou retour chariot. Les nombres, y compris négatifs, restent des
 * nombres.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;

export function neutralizeFormula(v: unknown): string {
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  const s = v === null || v === undefined ? "" : String(v);
  return FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) ? `'${s}` : s;
}

/** Cellule entre guillemets, guillemets doublés, formule neutralisée. */
export function csvCell(v: unknown): string {
  return `"${neutralizeFormula(v).replace(/"/g, '""')}"`;
}

/** Inverse de `neutralizeFormula`, pour relire un fichier exporté par Kanoo. */
export function restoreFormulaPrefix(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}
