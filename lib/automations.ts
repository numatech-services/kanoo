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
  /** Comptoir : vente sous le prix plancher, marge réalisée sous l'objectif de l'article. */
  comptoirMargins: { enabled: boolean; tolerancePts: number };
  /** Comptoir relié à EasyPay : événements en échec, tickets hors comptabilité, compte courant 467100. */
  easypayRecon: { enabled: boolean; threshold: number };
  /** Comptoir : réassort conseillé chaque matin ; bons de commande brouillon sur option. */
  comptoirReorder: { enabled: boolean; autoOrder: boolean };
  /** Contrôles de cohérence comptable du mois écoulé (ceux de l'export complet). */
  accountingChecks: { enabled: boolean; day: number; email: boolean };
  /** Échéances fiscales du CGI 2026 : TVA, acomptes d'IS, DSF. */
  fiscalCalendar: { enabled: boolean };
  /** Factures fournisseurs à payer dans les N jours, et en retard. */
  supplierPayments: { enabled: boolean; horizonDays: number };
  /** Appels d'offres déposés sans réponse depuis N jours. */
  tenderFollowup: { enabled: boolean; afterDays: number };
  /** Restauration : inventaire de fin de semaine ouvert d'office le jour choisi (0 = dimanche … 6 = samedi), rappel jusqu'à sa validation. */
  weeklyInventory: { enabled: boolean; day: number; level: "desk" | "both" };
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
  comptoirMargins: { enabled: true, tolerancePts: 5 },
  easypayRecon: { enabled: true, threshold: 500_000 },
  comptoirReorder: { enabled: true, autoOrder: false },
  accountingChecks: { enabled: true, day: 10, email: false },
  fiscalCalendar: { enabled: true },
  supplierPayments: { enabled: true, horizonDays: 7 },
  tenderFollowup: { enabled: true, afterDays: 30 },
  weeklyInventory: { enabled: true, day: 6, level: "both" },
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
  const cm = obj(r.comptoirMargins), er = obj(r.easypayRecon), cr = obj(r.comptoirReorder), ac = obj(r.accountingChecks);
  const fc = obj(r.fiscalCalendar), sp = obj(r.supplierPayments), tf = obj(r.tenderFollowup), wi = obj(r.weeklyInventory);
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
    comptoirMargins: { enabled: bool(cm.enabled, d.comptoirMargins.enabled), tolerancePts: int(cm.tolerancePts, 0, 50, d.comptoirMargins.tolerancePts) },
    easypayRecon: { enabled: bool(er.enabled, d.easypayRecon.enabled), threshold: int(er.threshold, 0, 1e10, d.easypayRecon.threshold) },
    comptoirReorder: { enabled: bool(cr.enabled, d.comptoirReorder.enabled), autoOrder: bool(cr.autoOrder, d.comptoirReorder.autoOrder) },
    accountingChecks: { enabled: bool(ac.enabled, d.accountingChecks.enabled), day: int(ac.day, 1, 28, d.accountingChecks.day), email: bool(ac.email, d.accountingChecks.email) },
    fiscalCalendar: { enabled: bool(fc.enabled, d.fiscalCalendar.enabled) },
    supplierPayments: { enabled: bool(sp.enabled, d.supplierPayments.enabled), horizonDays: int(sp.horizonDays, 1, 60, d.supplierPayments.horizonDays) },
    tenderFollowup: { enabled: bool(tf.enabled, d.tenderFollowup.enabled), afterDays: int(tf.afterDays, 7, 180, d.tenderFollowup.afterDays) },
    weeklyInventory: { enabled: bool(wi.enabled, d.weeklyInventory.enabled), day: int(wi.day, 0, 6, d.weeklyInventory.day), level: wi.level === "desk" ? "desk" : wi.level === "both" ? "both" : d.weeklyInventory.level },
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

// ─── Calendrier fiscal (CGI 2026, docs/REFERENTIEL-FISCAL-SOCIAL-2026.md) ─────

export interface FiscalReminder {
  /** Clé unique de l'échéance (un seul rappel par clé et par organisation). */
  key: string;
  kind: "tva_prepare" | "tva_due" | "tva_urgent" | "is_acompte" | "dsf";
  title: string;
  message: string;
  /** Période concernée (TVA) ou exercice (IS, DSF). */
  period: { year: number; month?: number; index?: number };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Rappels fiscaux dus à une date (heure de Niamey) :
 *  - TVA du mois écoulé, déclarée et payée avant le 15 : préparation dès le 1er,
 *    rappel les 10, 11 et 12, dernier rappel les 13 et 14 ;
 *  - acomptes d'IS : 3 × 20 % de l'impôt de l'exercice précédent, avant le
 *    1er juillet, le 1er septembre et le 1er novembre — rappel 15 jours avant ;
 *  - DSF (déclaration statistique et fiscale) avant le 30 avril — rappel dès le 1er avril.
 * Chaque rappel a sa clé : un jour manqué est rattrapé, rien n'est envoyé deux fois.
 */
export function fiscalRemindersDue(now: Date): FiscalReminder[] {
  const d = niameyDate(now);
  const out: FiscalReminder[] = [];
  const prev = previousMonth(d.year, d.month);
  const label = `${MONTHS_FR[prev.month - 1]} ${prev.year}`;
  const deadline = `15/${pad(d.month)}/${d.year}`;
  const vat = (kind: FiscalReminder["kind"], title: string, message: string) =>
    out.push({ key: `fiscal:${kind}:${prev.year}-${pad(prev.month)}`, kind, title, message, period: { year: prev.year, month: prev.month } });
  if (d.day >= 1 && d.day < 10) vat("tva_prepare", `TVA de ${label} à préparer`, `La déclaration de TVA de ${label} est à déposer et à payer avant le ${deadline}.`);
  if (d.day >= 10 && d.day < 13) vat("tva_due", `TVA de ${label} : échéance le ${deadline}`, `La TVA de ${label} n'est pas encore enregistrée comme déclarée. Échéance : avant le ${deadline}.`);
  if (d.day >= 13 && d.day <= 14) vat("tva_urgent", `TVA de ${label} : dernier délai`, `Dernier délai pour déposer et payer la TVA de ${label} : avant le ${deadline}. Au-delà, des pénalités s'appliquent.`);
  // Acomptes d'IS de l'année en cours (sur l'impôt de l'exercice précédent).
  [[7, 1], [9, 1], [11, 1]].forEach(([m, day], i) => {
    const due = Date.UTC(d.year, m - 1, day);
    const today = Date.UTC(d.year, d.month - 1, d.day);
    const left = Math.round((due - today) / 86_400_000);
    if (left >= 1 && left <= 15) out.push({
      key: `fiscal:is_acompte:${d.year}-${i + 1}`, kind: "is_acompte", period: { year: d.year, index: i + 1 },
      title: `Acompte d'IS/IMF n° ${i + 1} avant le ${pad(day)}/${pad(m)}/${d.year}`,
      message: `${i === 0 ? "1er" : `${i + 1}e`} acompte d'IS/IMF (20 % de l'impôt de l'exercice ${d.year - 1}) à verser avant le ${pad(day)}/${pad(m)}/${d.year}.`,
    });
  });
  if (d.month === 4 && d.day <= 30) out.push({
    key: `fiscal:dsf:${d.year - 1}`, kind: "dsf", period: { year: d.year - 1 },
    title: `DSF ${d.year - 1} au plus tard le 30/04/${d.year}`,
    message: `La déclaration statistique et fiscale de l'exercice ${d.year - 1} (états financiers, liste des principaux clients et fournisseurs, relevé des amortissements) est à déposer au plus tard le 30 avril.`,
  });
  return out;
}

// ─── Fournisseurs : échéancier et balance âgée ───────────────────────────────

export type AgingBucket = "overdue_90" | "overdue_60" | "overdue_30" | "overdue" | "due_7" | "due_30" | "later" | "no_date";
export const AGING_LABEL: Record<AgingBucket, string> = {
  overdue_90: "Échu depuis plus de 90 jours", overdue_60: "Échu de 61 à 90 jours", overdue_30: "Échu de 31 à 60 jours", overdue: "Échu de 1 à 30 jours",
  due_7: "À payer sous 7 jours", due_30: "À payer de 8 à 30 jours", later: "À payer au-delà de 30 jours", no_date: "Sans échéance",
};

/** Tranche d'ancienneté d'une dette selon son échéance (jours civils, heure de Niamey). */
export function agingBucket(dueDate: Date | string | null | undefined, now: Date): AgingBucket {
  if (!dueDate) return "no_date";
  const d = niameyDate(now);
  const due = new Date(dueDate);
  const dd = niameyDate(due);
  const days = Math.round((Date.UTC(d.year, d.month - 1, d.day) - Date.UTC(dd.year, dd.month - 1, dd.day)) / 86_400_000);
  if (days > 90) return "overdue_90";
  if (days > 60) return "overdue_60";
  if (days > 30) return "overdue_30";
  if (days > 0) return "overdue";
  if (days >= -7) return "due_7";
  if (days >= -30) return "due_30";
  return "later";
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
