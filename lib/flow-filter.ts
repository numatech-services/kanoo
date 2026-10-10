/**
 * Filtre commun « Recettes / Dépenses / Tout » et période, pour toutes les
 * listes d'argent (caisse de comptoir, trésorerie, analytique, journal).
 * Même lecture partout : `flow=in|out`, `from` / `to` en dates locales
 * (AAAA-MM-JJ), la date de fin incluse jusqu'à minuit.
 */
export type Flow = "in" | "out";

export function parseFlow(v: string | null | undefined): Flow | null {
  return v === "in" || v === "out" ? v : null;
}

export interface Period { from?: Date; to?: Date }

function day(v: string | null, end: boolean): Date | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) return undefined;
  const d = new Date(`${v.slice(0, 10)}T${end ? "23:59:59.999" : "00:00:00.000"}`);
  return isNaN(d.getTime()) ? undefined : d;
}

export function parsePeriod(url: URL): Period {
  return { from: day(url.searchParams.get("from"), false), to: day(url.searchParams.get("to"), true) };
}

/** Condition MongoDB sur un champ date ; vide si aucune borne. */
export function periodMatch(field: string, p: Period): Record<string, unknown> {
  if (!p.from && !p.to) return {};
  return { [field]: { ...(p.from ? { $gte: p.from } : {}), ...(p.to ? { $lte: p.to } : {}) } };
}

/** Totaux renvoyés avec chaque liste : sur la période, tous sens confondus. */
export interface FlowTotals { in: number; out: number; balance: number }
export const flowTotals = (inSum: number, outSum: number): FlowTotals =>
  ({ in: Math.round(inSum), out: Math.round(outSum), balance: Math.round(inSum - outSum) });
