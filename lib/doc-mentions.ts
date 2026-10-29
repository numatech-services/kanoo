/**
 * Mentions imprimées d'un document commercial (devis, proforma, facture) :
 * objet, référence (convention, bon de commande du client), période,
 * « à l'attention de ». Lues dans une requête : seules les clés présentes
 * sont rendues (une chaîne vide efface la mention).
 */
export const MENTION_LIMITS = { object: 600, reference: 120, period: 120, attention: 160 } as const;
export type MentionKey = keyof typeof MENTION_LIMITS;

export function mentionsFrom(body: Record<string, unknown>): Partial<Record<MentionKey, string | undefined>> {
  const out: Partial<Record<MentionKey, string | undefined>> = {};
  for (const k of Object.keys(MENTION_LIMITS) as MentionKey[]) {
    if (!(k in body)) continue;
    const v = String(body[k] ?? "").trim().slice(0, MENTION_LIMITS[k]);
    out[k] = v || undefined;
  }
  return out;
}

/** Les mentions d'un document, recopiées sur un autre (devis → facture). */
export function copyMentions(src: Partial<Record<MentionKey, unknown>>): Partial<Record<MentionKey, string>> {
  const out: Partial<Record<MentionKey, string>> = {};
  for (const k of Object.keys(MENTION_LIMITS) as MentionKey[]) if (typeof src[k] === "string" && src[k]) out[k] = src[k] as string;
  return out;
}

/**
 * Conditions d'un devis reprises sur sa facture : les clauses propres à
 * l'offre (« Validité — … », « Offre valable … ») n'ont rien à faire sur une
 * facture, qui a son échéance.
 */
export function invoiceTerms(terms?: string | null): string {
  return String(terms ?? "").split(/\n/)
    .filter(l => !/^\s*(validit[ée]|offre valable|dur[ée]e de validit[ée]|nature du document)/i.test(l))
    .join("\n").trim();
}
