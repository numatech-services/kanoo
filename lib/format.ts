/**
 * Formats d'affichage communs : montants, nombres, dates, pourcentages.
 *
 * L'audit comptait 31 fonctions `fmt` locales, qui affichaient tantôt
 * « XOF », tantôt « F CFA », tantôt rien, et arrondissaient ou non. La devise
 * reste stockée sous son code ISO (XOF) ; à l'écran et sur les documents, on
 * écrit « FCFA », la forme que lisent les clients et l'administration.
 */

export const CURRENCY_LABEL = "FCFA";

/**
 * Jour local AAAA-MM-JJ (fuseau de l'appareil, ou du serveur : Africa/Niamey,
 * instrumentation.ts). `toISOString().slice(0, 10)` donnait le jour UTC : de
 * minuit à 1 h à Niamey, c'était encore la veille, et une date construite à
 * minuit local (fin du mois dernier…) reculait d'un jour.
 */
export function localDay(d: Date | string | number = new Date()): string {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/** Aujourd'hui, jour local AAAA-MM-JJ (valeur d'un champ date). */
export const todayLocal = (): string => localDay(new Date());

const NUMBER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** 1250000 → « 1 250 000 ». Nombres entiers : le franc CFA n'a pas de centimes. */
export function formatNumber(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? NUMBER.format(Math.round(v)) : "0";
}

/** Quantités et taux : jusqu'à deux décimales. */
export function formatDecimal(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? DECIMAL.format(v) : "0";
}

/** 1250000 → « 1 250 000 FCFA ». `null` / `undefined` → « — » si `dash`. */
export function formatMoney(n: unknown, opts: { dash?: boolean; unit?: boolean } = {}): string {
  if ((n === null || n === undefined || n === "") && opts.dash) return "—";
  const s = formatNumber(n);
  return opts.unit === false ? s : `${s} ${CURRENCY_LABEL}`;
}

/** 2 500 000 → « 2,5 M FCFA » pour les cartes d'indicateurs. */
export function formatMoneyShort(n: unknown): string {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${DECIMAL.format(Math.round(v / 1e8) / 10)} Md ${CURRENCY_LABEL}`;
  if (abs >= 1_000_000) return `${DECIMAL.format(Math.round(v / 1e5) / 10)} M ${CURRENCY_LABEL}`;
  return formatMoney(v);
}

/** 0.1834 → « 18,3 % ». */
export function formatPercent(ratio: unknown, digits = 1): string {
  const v = Number(ratio);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
}

function toDate(d: unknown): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(String(d));
  return isNaN(date.getTime()) ? null : date;
}

/** « 11/10/2026 », ou « — » sans date. */
export function formatDate(d: unknown): string {
  const date = toDate(d);
  return date ? date.toLocaleDateString("fr-FR") : "—";
}

/** « 11 oct. 2026 ». */
export function formatDateLong(d: unknown): string {
  const date = toDate(d);
  return date ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

/** « 11/10/2026 14:05 ». */
export function formatDateTime(d: unknown): string {
  const date = toDate(d);
  return date ? `${date.toLocaleDateString("fr-FR")} ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "—";
}

/** Taille de fichier : « 820 Ko », « 2,4 Mo ». */
export function formatFileSize(bytes: unknown): string {
  const b = Number(bytes);
  if (!b) return "—";
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} Ko`;
  return `${DECIMAL.format(Math.round(b / 1024 / 102.4) / 10)} Mo`;
}
