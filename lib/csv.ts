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

// Windows-1252 : Latin-1, plus ces caractères en 0x80-0x9F.
const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
  // Espaces insécables fines (séparateur de milliers de toLocaleString) : espace insécable.
  0x202f: 0xa0, 0x2009: 0x20,
};

/**
 * Texte encodé en Windows-1252, l'encodage qu'attendent Sage 100 et la
 * plupart des logiciels comptables sous Windows. Un fichier annoncé
 * « windows-1252 » mais écrit en UTF-8 faisait arriver « Ã© » à la place de
 * « é » dans chaque libellé importé. Caractère sans équivalent : « ? ».
 */
export function encodeWindows1252(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(s.length));
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out[n++] = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252_EXTRA[c] ?? 0x3f;
  }
  return out.slice(0, n);
}
