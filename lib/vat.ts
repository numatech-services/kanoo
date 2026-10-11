/**
 * TVA d'une période lue en comptabilité. Collectée : comptes 443 (TVA
 * facturée). Déductible : comptes 445 (récupérable sur achats 4452, sur
 * immobilisations 4451, sur services…). Les états lisaient le seul 445000,
 * qu'aucune écriture n'alimente : la TVA déductible ressortait toujours à zéro.
 */
export const VAT_LINES_MATCH = { "lines.accountCode": { $regex: "^44[35]" } };

export function vatFromEntries(entries: Array<{ lines: Array<{ accountCode: string; debit?: number; credit?: number }> }>) {
  let collected = 0, deductible = 0;
  for (const e of entries) for (const l of e.lines) {
    if (l.accountCode.startsWith("443")) collected += (l.credit || 0) - (l.debit || 0);
    else if (l.accountCode.startsWith("445")) deductible += (l.debit || 0) - (l.credit || 0);
  }
  return { collected: Math.round(collected), deductible: Math.round(deductible), net: Math.round(collected - deductible) };
}
