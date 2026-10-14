/**
 * Lettrage automatique d'un compte de tiers — règles pures.
 *
 * Trois passes, de la plus sûre à la moins sûre ; une écriture n'entre que
 * dans un seul groupe, et un groupe n'est retenu que s'il se solde exactement :
 *  1. une écriture et son extourne ;
 *  2. les pièces d'un même document (facture, ses règlements et ses avoirs ;
 *     achat et ses règlements), pour un même tiers ;
 *  3. pour un même tiers, un débit et un crédit de même montant (du plus ancien
 *     au plus récent), puis tout le reste du tiers s'il se solde.
 */

export interface LetterLine {
  entryId: string;
  date: Date | string;
  thirdPartyId: string | null;
  /** Montant net de l'écriture sur le compte : débit − crédit. */
  amount: number;
  /** Clé du document d'origine (facture, achat), si on la connaît. */
  docKey?: string | null;
  /** Clé d'extourne : identique pour une écriture et son miroir. */
  reversalKey?: string | null;
}

export interface LetterGroup { entryIds: string[]; rule: "reversal" | "document" | "amount" | "balance"; thirdPartyId: string | null; total: number }

const zero = (n: number) => Math.abs(n) <= 1;

export function proposeLetters(lines: LetterLine[]): LetterGroup[] {
  const left = new Map(lines.filter(l => l.amount !== 0).map(l => [l.entryId, l]));
  const groups: LetterGroup[] = [];
  const take = (ls: LetterLine[], rule: LetterGroup["rule"]) => {
    ls.forEach(l => left.delete(l.entryId));
    groups.push({ entryIds: ls.map(l => l.entryId), rule, thirdPartyId: ls[0].thirdPartyId, total: ls.filter(l => l.amount > 0).reduce((t, l) => t + l.amount, 0) });
  };
  const byKey = (key: (l: LetterLine) => string | null | undefined) => {
    const m = new Map<string, LetterLine[]>();
    for (const l of left.values()) { const k = key(l); if (!k) continue; const a = m.get(k); if (a) a.push(l); else m.set(k, [l]); }
    return m;
  };

  // 1. Extournes.
  for (const ls of byKey(l => l.reversalKey).values()) if (ls.length >= 2 && zero(ls.reduce((t, l) => t + l.amount, 0))) take(ls, "reversal");
  // 2. Documents, tiers par tiers.
  for (const ls of byKey(l => (l.docKey ? `${l.docKey}|${l.thirdPartyId ?? ""}` : null)).values()) {
    if (ls.length >= 2 && ls.some(l => l.amount > 0) && ls.some(l => l.amount < 0) && zero(ls.reduce((t, l) => t + l.amount, 0))) take(ls, "document");
  }
  // 3a. Montants identiques, par tiers, du plus ancien au plus récent.
  for (const ls of byKey(l => l.thirdPartyId).values()) {
    const sorted = [...ls].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const used = new Set<string>();
    for (const d of sorted.filter(l => l.amount > 0)) {
      if (used.has(d.entryId)) continue;
      const c = sorted.find(x => x.amount < 0 && !used.has(x.entryId) && zero(x.amount + d.amount));
      if (!c) continue;
      used.add(d.entryId); used.add(c.entryId);
      take([d, c], "amount");
    }
  }
  // 3b. Solde complet du tiers.
  for (const ls of byKey(l => l.thirdPartyId).values()) {
    if (ls.length >= 2 && zero(ls.reduce((t, l) => t + l.amount, 0))) take(ls, "balance");
  }
  return groups;
}
