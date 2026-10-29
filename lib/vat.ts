/**
 * TVA d'une période lue en comptabilité. Collectée : comptes 443 (TVA
 * facturée). Déductible : comptes 445 (récupérable sur achats 4452, sur
 * immobilisations 4451, sur services…). Les états lisaient le seul 445000,
 * qu'aucune écriture n'alimente : la TVA déductible ressortait toujours à zéro.
 */
// À-nouveaux exclus : ils reprennent les soldes 443/445 au 1er janvier, ce ne sont pas des opérations du mois.
export const VAT_LINES_MATCH = { "lines.accountCode": { $regex: "^44[35]" }, journalCode: { $ne: "AN" } };

/**
 * Une écriture compte pour la déclaration si c'est une opération imposable
 * (vente, achat, avoir, note de frais, ticket… et leurs extournes) : elle
 * touche un compte de tiers (40, 41, 42), de charges ou de produits (6, 7) ou
 * d'immobilisation (2). Le règlement de la TVA à la DGI (443 contre banque)
 * n'en est pas une : il diminuait la TVA collectée du mois du paiement.
 */
export const isTaxableOperation = (lines: Array<{ accountCode: string }>) => lines.some(l => /^(2|40|41|42|6|7)/.test(l.accountCode));

export function vatFromEntries(entries: Array<{ journalCode?: string; lines: Array<{ accountCode: string; debit?: number; credit?: number }> }>) {
  let collected = 0, deductible = 0;
  for (const e of entries) {
    if (e.journalCode === "AN" || !isTaxableOperation(e.lines)) continue;
    for (const l of e.lines) {
    if (l.accountCode.startsWith("443")) collected += (l.credit || 0) - (l.debit || 0);
    else if (l.accountCode.startsWith("445")) deductible += (l.debit || 0) - (l.credit || 0);
    }
  }
  return { collected: Math.round(collected), deductible: Math.round(deductible), net: Math.round(collected - deductible) };
}
