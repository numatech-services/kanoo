/**
 * Brief du jour — classement des actions prioritaires.
 *
 * En ouvrant Kanoo le matin, le dirigeant ne doit pas lire dix indicateurs pour
 * savoir quoi faire : le brief retient trois actions, chacune avec la raison
 * qui la rend prioritaire et le lien qui permet de la faire. Ce module ne lit
 * aucune donnée : il classe des candidats (lib/daily-brief-server les produit),
 * ce qui le rend testable et explicable.
 *
 * Score = poids de la catégorie × enjeu (échelle logarithmique du montant)
 *         × urgence (retard ou proximité de l'échéance).
 */

export type BriefKind =
  | "treasury_shortfall" | "vat_deadline" | "overdue_receivables" | "supplier_overdue" | "supplier_due"
  | "admin_doc_expired" | "admin_doc_expiring" | "draft_invoices" | "approvals_pending"
  | "expenses_to_validate" | "quotes_expiring" | "stock_low" | "desk_unlinked";

export interface BriefCandidate {
  kind: BriefKind;
  title: string;
  why: string;
  href: string;
  cta: string;
  /** Enjeu en FCFA, quand il y en a un. */
  amount?: number;
  /** Jours de retard (> 0) ou jours restants avant l'échéance (< 0 non utilisé). */
  daysLate?: number;
  daysLeft?: number;
}

export interface BriefItem extends BriefCandidate { score: number; tone: "neg" | "warn" | "info" }

const WEIGHT: Record<BriefKind, number> = {
  treasury_shortfall: 10,
  vat_deadline: 7,
  overdue_receivables: 6,
  supplier_overdue: 6,
  admin_doc_expired: 6,
  supplier_due: 4,
  draft_invoices: 4,
  approvals_pending: 4,
  admin_doc_expiring: 3,
  expenses_to_validate: 3,
  quotes_expiring: 3,
  stock_low: 3,
  desk_unlinked: 2,
};

const TONE: Partial<Record<BriefKind, BriefItem["tone"]>> = {
  treasury_shortfall: "neg", vat_deadline: "warn", overdue_receivables: "neg", supplier_overdue: "neg",
  admin_doc_expired: "neg", supplier_due: "warn", admin_doc_expiring: "warn",
};

export function scoreCandidate(c: BriefCandidate): number {
  const stake = c.amount && c.amount > 0 ? 1 + Math.log10(1 + c.amount / 100_000) : 1;
  let urgency = 1;
  if (c.daysLate !== undefined && c.daysLate > 0) urgency = 1 + Math.min(c.daysLate, 90) / 30;
  else if (c.daysLeft !== undefined) urgency = 1 + Math.max(0, 10 - Math.max(0, c.daysLeft)) / 10;
  return Math.round(WEIGHT[c.kind] * stake * urgency * 100) / 100;
}

/** Les `limit` actions les plus prioritaires, une seule par catégorie. */
export function rankBrief(candidates: BriefCandidate[], limit = 3): BriefItem[] {
  const best = new Map<BriefKind, BriefItem>();
  for (const c of candidates) {
    const item: BriefItem = { ...c, score: scoreCandidate(c), tone: TONE[c.kind] ?? "info" };
    const cur = best.get(c.kind);
    if (!cur || item.score > cur.score) best.set(c.kind, item);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** « 3 factures » / « 1 facture ». */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n > 1 ? many : one}`;
}
