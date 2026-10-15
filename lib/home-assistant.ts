/**
 * Assistant du tableau de bord : reconnaît l'intention d'une question en
 * français et désigne le client visé. Pur, donc testable ; les chiffres sont
 * lus par la route, jamais inventés.
 */
export type Intent = "overdue" | "drafts" | "client_due" | "receivables" | "treasury" | "revenue" | "collected" | "help";

export const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ");

const STOP = new Set(["combien", "doit", "dois", "nous", "moi", "quel", "quelle", "quelles", "quels", "sont", "est", "les", "des", "une", "factures", "facture", "client", "clients", "pour", "avec", "dans", "reste", "encore", "total", "montant", "universite"]);

export function detectIntent(q: string): Intent {
  const s = normalize(q);
  if (/brouillon/.test(s)) return "drafts";
  if (/retard|impaye|echu/.test(s)) return "overdue";
  if (/(doit|dois|du |dues?\b|creance|a encaisser|reste a payer)/.test(s)) return /(me |nous |m |)doit|doivent/.test(s) && keywords(q).length ? "client_due" : "receivables";
  // « encaissé » contient « caisse » : les encaissements passent avant la trésorerie.
  if (/encaiss|\brecu\b|\brentre/.test(s)) return "collected";
  if (/tresorerie|\bsolde\b|\bbanques?\b|\bcaisses?\b|liquidit/.test(s)) return "treasury";
  if (/chiffre d affaires|\bca\b|ventes?|facture ce|facture cette/.test(s)) return "revenue";
  return "help";
}

/** Mots porteurs d'un nom propre (client) dans la question. */
export function keywords(q: string): string[] {
  return normalize(q).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w));
}

/** Meilleur client : celui dont le nom contient le plus de mots de la question. */
export function bestClient<T extends { name: string }>(q: string, clients: T[]): T | null {
  const kw = keywords(q);
  let best: T | null = null, score = 0;
  for (const c of clients) {
    const name = normalize(c.name);
    const sc = kw.filter(w => name.includes(w)).length;
    if (sc > score) { best = c; score = sc; }
  }
  return score > 0 ? best : null;
}
