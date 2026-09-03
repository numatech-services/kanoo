/**
 * Relevé de compte client.
 *
 * Le document qu'on envoie quand un client dit « je ne sais plus ce que je
 * vous dois ». Il ne se contente pas d'un solde : il donne la suite des
 * mouvements qui y mènent, dans l'ordre, avec un solde courant après chacun.
 * Un solde sans son chemin ne se conteste pas — il se subit, ce qui n'aide
 * personne à payer.
 */

export type StatementKind = "invoice" | "credit_note" | "payment";

export interface StatementSource {
  _id: unknown;
  kind: StatementKind;
  date: Date | string;
  reference: string;
  label?: string;
  /**
   * Montant **signé du point de vue de la créance** : positif quand le client
   * doit davantage (facture), négatif quand la dette diminue (règlement,
   * avoir). Le signe est posé ici une fois pour toutes plutôt que redécidé à
   * chaque addition — c'est ainsi qu'un avoir finit par gonfler un solde.
   */
  amount: number;
  dueDate?: Date | string | null;
}

export interface StatementRow extends StatementSource {
  /** Solde de la créance après ce mouvement. */
  balance: number;
  /** Jours de retard à la date d'arrêté. Nul pour un règlement. */
  daysPastDue: number;
}

export interface StatementTotals {
  openingBalance: number;
  invoiced: number;
  credited: number;
  paid: number;
  closingBalance: number;
  /** Part échue du solde de clôture. */
  overdueAmount: number;
  oldestDueDate: Date | null;
}

export interface AgingSlice {
  label: string;
  from: number;
  to: number | null;
  amount: number;
  count: number;
}

export interface Statement {
  from: Date;
  to: Date;
  rows: StatementRow[];
  totals: StatementTotals;
  aging: AgingSlice[];
}

const DAY = 86_400_000;

function startOfDay(value: Date | string): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from: Date | string, to: Date | string): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/**
 * Construit le relevé.
 *
 * `openingBalance` est le solde à la veille de `from` : il doit être calculé
 * par l'appelant sur **tous** les mouvements antérieurs, sinon le relevé
 * d'octobre commence à zéro et nie ce que le client devait déjà en septembre.
 *
 * Le tri est stable et déterministe : à date égale, une facture précède le
 * règlement qui l'éteint. Sans cette règle, un paiement daté du jour de la
 * facture affiche un solde négatif transitoire, que le client relève.
 */
export function buildStatement(
  sources: StatementSource[],
  openingBalance: number,
  from: Date,
  to: Date
): Statement {
  const ORDER: Record<StatementKind, number> = { invoice: 0, credit_note: 1, payment: 2 };

  const inPeriod = sources
    .filter(s => {
      const d = startOfDay(s.date).getTime();
      return d >= startOfDay(from).getTime() && d <= startOfDay(to).getTime();
    })
    .sort((a, b) => {
      const diff = startOfDay(a.date).getTime() - startOfDay(b.date).getTime();
      if (diff !== 0) return diff;
      const byKind = ORDER[a.kind] - ORDER[b.kind];
      if (byKind !== 0) return byKind;
      return a.reference.localeCompare(b.reference, "fr");
    });

  let balance = openingBalance;
  const rows: StatementRow[] = inPeriod.map(source => {
    balance += source.amount;
    return {
      ...source,
      balance,
      daysPastDue: source.kind === "invoice" && source.dueDate
        ? Math.max(0, daysBetween(source.dueDate, to))
        : 0,
    };
  });

  const invoiced = inPeriod.filter(s => s.kind === "invoice")
    .reduce((sum, s) => sum + s.amount, 0);
  const credited = inPeriod.filter(s => s.kind === "credit_note")
    .reduce((sum, s) => sum + Math.abs(s.amount), 0);
  const paid = inPeriod.filter(s => s.kind === "payment")
    .reduce((sum, s) => sum + Math.abs(s.amount), 0);

  return {
    from, to, rows,
    totals: {
      openingBalance,
      invoiced,
      credited,
      paid,
      closingBalance: balance,
      overdueAmount: 0,   // renseigné par `withOpenItems`
      oldestDueDate: null,
    },
    aging: [],
  };
}

export interface OpenItem {
  reference: string;
  dueDate: Date | string;
  /** Restant dû sur cette pièce : TTC − réglé − crédité. */
  outstanding: number;
}

/**
 * Complète le relevé par l'analyse des pièces encore ouvertes.
 *
 * L'ancienneté se calcule **pièce par pièce**, pas sur le solde global : un
 * client qui doit deux millions dont un depuis six mois n'est pas dans la même
 * situation qu'un client qui doit deux millions depuis huit jours, et c'est la
 * seule information qui décide d'une relance.
 */
export function withOpenItems(statement: Statement, openItems: OpenItem[], asOf: Date): Statement {
  const slices: AgingSlice[] = [
    { label: "Non échu", from: -Infinity, to: 1, amount: 0, count: 0 },
    { label: "1 – 30 j", from: 1, to: 31, amount: 0, count: 0 },
    { label: "31 – 60 j", from: 31, to: 61, amount: 0, count: 0 },
    { label: "61 – 90 j", from: 61, to: 91, amount: 0, count: 0 },
    { label: "Plus de 90 j", from: 91, to: null, amount: 0, count: 0 },
  ];

  let overdue = 0;
  let oldest: Date | null = null;

  for (const item of openItems) {
    if (item.outstanding <= 0) continue;
    const late = daysBetween(item.dueDate, asOf);
    const slice = slices.find(s => late >= s.from && (s.to === null || late < s.to));
    if (slice) {
      slice.amount += item.outstanding;
      slice.count += 1;
    }
    if (late >= 1) {
      overdue += item.outstanding;
      const due = new Date(item.dueDate);
      if (!oldest || due < oldest) oldest = due;
    }
  }

  return {
    ...statement,
    aging: slices,
    totals: { ...statement.totals, overdueAmount: overdue, oldestDueDate: oldest },
  };
}

/**
 * Phrase de synthèse.
 *
 * Placée en tête du relevé, elle dit en une ligne ce que les colonnes disent
 * en trente. Un relevé qu'on n'a pas le temps de lire ne se paie pas.
 */
export function summarySentence(totals: StatementTotals): string {
  const xof = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} XOF`;

  if (totals.closingBalance <= 0) {
    return totals.closingBalance < 0
      ? `Votre compte présente un avoir de ${xof(-totals.closingBalance)} en votre faveur.`
      : "Votre compte est soldé. Nous vous remercions de votre confiance.";
  }
  if (totals.overdueAmount <= 0) {
    return `Solde de ${xof(totals.closingBalance)}, dont aucune échéance dépassée à ce jour.`;
  }
  const since = totals.oldestDueDate
    ? ` La plus ancienne échéance dépassée date du ${new Date(totals.oldestDueDate).toLocaleDateString("fr-FR")}.`
    : "";
  return `Solde de ${xof(totals.closingBalance)}, dont ${xof(totals.overdueAmount)} échus.${since}`;
}

export const KIND_LABEL: Record<StatementKind, string> = {
  invoice: "Facture",
  credit_note: "Avoir",
  payment: "Règlement",
};
