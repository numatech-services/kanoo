/**
 * Automatisations de Kanoo — logique pure (sans base de données), testée
 * unitairement. Les tâches qui l'exécutent sont dans lib/automation-jobs.ts.
 *
 * Calendrier : les dates s'apprécient à l'heure de Niamey (UTC+1, sans heure
 * d'été), quelle que soit l'horloge du serveur — l'hébergeur tourne en UTC, et
 * « le 25 du mois » ou « lundi » doivent être ceux de l'organisation.
 */

export type BriefChannel = "email" | "whatsapp";
export type ReminderChannel = "email" | "sms" | "whatsapp";

export interface AutomationSettings {
  morningBrief: { enabled: boolean; channels: BriefChannel[]; days: number[]; recipientIds: string[] };
  treasuryAlert: { enabled: boolean; horizonDays: number; threshold: number };
  depreciation: { enabled: boolean };
  payroll: { enabled: boolean; reminderDay: number; autoGenerate: boolean };
  accountantPacket: { enabled: boolean; emails: string[]; day: number };
  approvalReminders: { enabled: boolean; afterHours: number };
  budgetAlerts: { enabled: boolean; thresholds: number[] };
  cotisationReminders: { enabled: boolean; channels: ReminderChannel[]; intervalDays: number };
}

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  morningBrief: { enabled: false, channels: ["email"], days: [1, 2, 3, 4, 5], recipientIds: [] },
  treasuryAlert: { enabled: true, horizonDays: 30, threshold: 0 },
  depreciation: { enabled: false },
  payroll: { enabled: true, reminderDay: 25, autoGenerate: false },
  accountantPacket: { enabled: false, emails: [], day: 5 },
  approvalReminders: { enabled: true, afterHours: 48 },
  budgetAlerts: { enabled: true, thresholds: [80, 100] },
  cotisationReminders: { enabled: false, channels: ["email"], intervalDays: 30 },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!Array.isArray(v)) return fallback;
  return [...new Set(v.filter((x): x is T => allowed.includes(x as T)))];
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

/**
 * Réglages complets à partir d'une saisie (ou d'un document en base) :
 * chaque champ absent ou invalide reprend la valeur par défaut, les nombres
 * sont bornés, les adresses vérifiées. Ne lève jamais.
 */
export function normalizeAutomationSettings(raw: unknown): AutomationSettings {
  const r = obj(raw);
  const d = DEFAULT_AUTOMATION_SETTINGS;
  const mb = obj(r.morningBrief), ta = obj(r.treasuryAlert), dep = obj(r.depreciation), pay = obj(r.payroll);
  const ap = obj(r.accountantPacket), ar = obj(r.approvalReminders), ba = obj(r.budgetAlerts), co = obj(r.cotisationReminders);
  const days = Array.isArray(mb.days) ? [...new Set(mb.days.map(Number).filter(x => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : d.morningBrief.days;
  const thresholds = Array.isArray(ba.thresholds)
    ? [...new Set(ba.thresholds.map(Number).filter(x => Number.isFinite(x) && x >= 10 && x <= 200).map(Math.round))].sort((a, b) => a - b)
    : d.budgetAlerts.thresholds;
  return {
    morningBrief: {
      enabled: bool(mb.enabled, d.morningBrief.enabled),
      channels: pick(mb.channels, ["email", "whatsapp"] as const, d.morningBrief.channels),
      days,
      recipientIds: Array.isArray(mb.recipientIds) ? [...new Set(mb.recipientIds.map(String).filter(x => OBJECT_ID_RE.test(x)))].slice(0, 20) : [],
    },
    treasuryAlert: {
      enabled: bool(ta.enabled, d.treasuryAlert.enabled),
      horizonDays: int(ta.horizonDays, 7, 90, d.treasuryAlert.horizonDays),
      threshold: int(ta.threshold, -1e12, 1e12, d.treasuryAlert.threshold),
    },
    depreciation: { enabled: bool(dep.enabled, d.depreciation.enabled) },
    payroll: {
      enabled: bool(pay.enabled, d.payroll.enabled),
      reminderDay: int(pay.reminderDay, 1, 28, d.payroll.reminderDay),
      autoGenerate: bool(pay.autoGenerate, d.payroll.autoGenerate),
    },
    accountantPacket: {
      enabled: bool(ap.enabled, d.accountantPacket.enabled),
      emails: Array.isArray(ap.emails) ? [...new Set(ap.emails.map(e => String(e).trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))].slice(0, 5) : [],
      day: int(ap.day, 1, 28, d.accountantPacket.day),
    },
    approvalReminders: {
      enabled: bool(ar.enabled, d.approvalReminders.enabled),
      afterHours: int(ar.afterHours, 12, 240, d.approvalReminders.afterHours),
    },
    budgetAlerts: { enabled: bool(ba.enabled, d.budgetAlerts.enabled), thresholds: thresholds.length ? thresholds : d.budgetAlerts.thresholds },
    cotisationReminders: {
      enabled: bool(co.enabled, d.cotisationReminders.enabled),
      channels: pick(co.channels, ["email", "sms", "whatsapp"] as const, d.cotisationReminders.channels),
      intervalDays: int(co.intervalDays, 7, 120, d.cotisationReminders.intervalDays),
    },
  };
}

// ─── Calendrier (heure de Niamey) ────────────────────────────────────────────

const NIAMEY_OFFSET_MS = 60 * 60 * 1000;

/** Date civile à Niamey : année, mois (1-12), jour, jour de la semaine (0 = dimanche). */
export function niameyDate(now: Date): { year: number; month: number; day: number; weekday: number; lastDayOfMonth: number } {
  const t = new Date(now.getTime() + NIAMEY_OFFSET_MS);
  const year = t.getUTCFullYear(), month = t.getUTCMonth() + 1, day = t.getUTCDate();
  return { year, month, day, weekday: t.getUTCDay(), lastDayOfMonth: new Date(Date.UTC(year, month, 0)).getUTCDate() };
}

/** « 2026-10-21 » — clé du jour, pour ne faire qu'un envoi par jour. */
export function dayKey(now: Date): string {
  const d = niameyDate(now);
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Mois précédent (année, mois 1-12). */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * Dossier mensuel du comptable : dû à partir du jour réglé, pour le mois
 * écoulé. Rattrape un jour manqué (cron en panne le 5 → envoi le 6), la clé de
 * période évitant le doublon.
 */
export function packetPeriodDue(now: Date, day: number): { year: number; month: number } | null {
  const d = niameyDate(now);
  return d.day >= day ? previousMonth(d.year, d.month) : null;
}

/** Rappel de paie : dû à partir du jour réglé, pour le mois en cours. */
export function payrollReminderDue(now: Date, reminderDay: number): { year: number; month: number } | null {
  const d = niameyDate(now);
  return d.day >= reminderDay ? { year: d.year, month: d.month } : null;
}

/** Dernier jour du mois à Niamey (génération d'office des bulletins). */
export function isLastDayOfMonth(now: Date): boolean {
  const d = niameyDate(now);
  return d.day === d.lastDayOfMonth;
}

export function isSendDay(now: Date, days: number[]): boolean {
  return days.includes(niameyDate(now).weekday);
}

// ─── Budget ──────────────────────────────────────────────────────────────────

/** Taux de consommation (en %) d'une enveloppe ; null si l'enveloppe est vide. */
export function consumption(used: number, allotted: number): number | null {
  if (!(allotted > 0)) return null;
  return Math.round((used / allotted) * 1000) / 10;
}

/** Seuils franchis, du plus haut au plus bas (on ne signale que le plus haut). */
export function crossedThresholds(pct: number | null, thresholds: number[]): number[] {
  if (pct === null) return [];
  return thresholds.filter(t => pct >= t).sort((a, b) => b - a);
}

// ─── Trésorerie ──────────────────────────────────────────────────────────────

export interface ForecastPoint { start: Date | string; balance: number }

/**
 * Première semaine, dans l'horizon, où le solde prévu passe sous le seuil.
 * Retourne aussi le point le plus bas de l'horizon, pour dire « jusqu'où ».
 */
export function treasuryBreach(series: ForecastPoint[], threshold: number, horizonDays: number, now: Date):
  { firstWeek: Date; balance: number; lowest: number; lowestWeek: Date } | null {
  const limit = now.getTime() + horizonDays * 86_400_000;
  const within = series.filter(p => new Date(p.start).getTime() <= limit);
  const first = within.find(p => p.balance < threshold);
  if (!first) return null;
  const low = within.reduce((m, p) => (p.balance < m.balance ? p : m), within[0]);
  return { firstWeek: new Date(first.start), balance: first.balance, lowest: low.balance, lowestWeek: new Date(low.start) };
}

// ─── Brief du matin ──────────────────────────────────────────────────────────

export interface BriefLine { title: string; why: string; href: string }

const fcfa = (n: number) => `${Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;

/** Brief en texte simple (WhatsApp) : court, sans mise en forme qui casserait. */
export function briefText(opts: { firstName?: string; tenantName: string; cash?: number | null; items: BriefLine[]; baseUrl: string; dateLabel: string }): string {
  const lines = [`Bonjour${opts.firstName ? ` ${opts.firstName}` : ""}, voici le point du ${opts.dateLabel} pour ${opts.tenantName}.`];
  if (typeof opts.cash === "number") lines.push(`Trésorerie disponible : ${fcfa(opts.cash)}.`);
  if (opts.items.length === 0) lines.push("Rien d'urgent aujourd'hui.");
  opts.items.forEach((it, i) => lines.push(`${i + 1}. ${it.title} — ${it.why}`));
  lines.push(`Ouvrir Kanoo : ${opts.baseUrl}/dashboard`);
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Corps HTML du brief (e-mail). Les liens pointent vers l'application, jamais ailleurs. */
export function briefHtml(opts: { firstName?: string; tenantName: string; cash?: number | null; items: BriefLine[]; baseUrl: string; dateLabel: string }): string {
  const items = opts.items.length
    ? `<ol style="padding-left:18px;margin:0 0 16px;">${opts.items.map(it =>
        `<li style="margin-bottom:10px;"><a href="${esc(opts.baseUrl + it.href)}" style="color:#2F59DF;font-weight:600;text-decoration:none;">${esc(it.title)}</a><br><span style="color:#6B7280;font-size:13px;">${esc(it.why)}</span></li>`).join("")}</ol>`
    : `<p style="margin:0 0 16px;">Rien d'urgent aujourd'hui.</p>`;
  return [
    `<p style="margin:0 0 12px;">Bonjour${opts.firstName ? ` ${esc(opts.firstName)}` : ""},</p>`,
    `<p style="margin:0 0 16px;">Voici le point du ${esc(opts.dateLabel)} pour <strong>${esc(opts.tenantName)}</strong>.</p>`,
    typeof opts.cash === "number" ? `<p style="margin:0 0 16px;font-size:15px;">Trésorerie disponible : <strong>${esc(fcfa(opts.cash))}</strong></p>` : "",
    items,
    `<p style="margin:0;"><a href="${esc(opts.baseUrl)}/dashboard" style="display:inline-block;background:#2F59DF;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Ouvrir Kanoo</a></p>`,
    `<p style="margin:16px 0 0;color:#9CA3AF;font-size:11px;">Envoi automatique — réglable dans Réglages → Automatisations.</p>`,
  ].join("");
}

export const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** « mardi 21 octobre ». */
export function dateLabel(now: Date): string {
  const d = niameyDate(now);
  return `${WEEKDAYS_FR[d.weekday]} ${d.day} ${MONTHS_FR[d.month - 1]}`;
}
