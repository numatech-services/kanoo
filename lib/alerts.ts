/**
 * Alertes et échéances saisies à la main : « contrat à enregistrer dans le
 * mois, sinon pénalités », renouvellement d'une assurance, dépôt d'un dossier.
 *
 * Fonctions pures (aucune lecture en base) : le calendrier des rappels se
 * teste sans serveur. La lecture et l'envoi sont dans lib/alerts-server.ts et
 * la tâche quotidienne « alerts-due » (lib/cron-jobs.ts).
 */

export const ALERT_CATEGORIES = {
  contrat: "Contrat (enregistrement, renouvellement)",
  fiscal: "Fiscal (déclaration, paiement)",
  social: "Social (CNSS, inspection du travail)",
  administratif: "Administratif (agrément, assurance, bail)",
  banque: "Banque (caution, échéance d'emprunt)",
  autre: "Autre",
} as const;
export type AlertCategory = keyof typeof ALERT_CATEGORIES;

export const ALERT_REPEATS = {
  none: "Une seule fois",
  monthly: "Tous les mois",
  quarterly: "Tous les trimestres",
  yearly: "Tous les ans",
} as const;
export type AlertRepeat = keyof typeof ALERT_REPEATS;

/** Clé propre d'une table : « constructor » ou « toString » ne sont pas des catégories. */
export function isOwnKey<T extends object>(table: T, key: unknown): key is keyof T {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key);
}

export const ALERT_STATUSES = ["open", "done", "cancelled"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** Rappels par défaut : une semaine avant, puis la veille. */
export const DEFAULT_REMIND_DAYS = [7, 1];
/** Horizon du tableau de bord : ce qui tombe dans le mois. */
export const DASHBOARD_HORIZON_DAYS = 30;
const MAX_REMIND_DAYS = 365;
const DAY = 86_400_000;

/** Jours entre aujourd'hui et l'échéance (négatif : en retard), au jour près. */
export function daysLeft(due: Date | string, now = new Date()): number {
  const d = new Date(due); d.setHours(0, 0, 0, 0);
  const t = new Date(now); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / DAY);
}

/**
 * Délais de prévenance saisis (« 30, 7, 1 ») : entiers de 0 à 365, sans
 * doublon, du plus lointain au plus proche, six au plus. Vide → défaut.
 */
export function normalizeRemindDays(input: unknown): number[] {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,;]+/) : [];
  const days = [...new Set(raw
    // Une saisie vide (« ») donnait 0 : un rappel le jour même au lieu du défaut.
    .filter(v => typeof v === "number" || String(v ?? "").trim() !== "")
    .map(v => (typeof v === "number" ? v : Number(String(v).trim())))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= MAX_REMIND_DAYS))]
    .sort((a, b) => b - a)
    .slice(0, 6);
  return days.length ? days : [...DEFAULT_REMIND_DAYS];
}

/**
 * Délais saisis dans le formulaire, contrôlés : « 1 mois » ou « quinze »
 * étaient remplacés en silence. Vide → défaut.
 */
export function parseRemindDays(input: unknown): { days: number[] } | { error: string } {
  const bad = { error: "Prévenir (jours avant) : des nombres de jours entre 0 et 365, séparés par des virgules (ex. : 30, 7, 1)." };
  if (input === undefined || input === null || input === "") return { days: [...DEFAULT_REMIND_DAYS] };
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\s,;]+/).filter(Boolean) : null;
  if (!raw) return bad;
  const nums = raw.map(v => (typeof v === "number" ? v : typeof v === "string" && /^\d{1,3}$/.test(v.trim()) ? Number(v.trim()) : NaN));
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > MAX_REMIND_DAYS)) return bad;
  if (new Set(nums).size > 6) return { error: "Prévenir (jours avant) : six délais au plus." };
  return { days: normalizeRemindDays(nums) };
}

/**
 * Étape de rappel en cours, ou null s'il est trop tôt.
 *
 *  - avant l'échéance : la plus proche des prévenances déjà atteintes
 *    (« J-7 », puis « J-1 ») — une tâche qui n'a pas tourné un jour rattrape
 *    l'étape le lendemain au lieu de la perdre ;
 *  - le jour même : « J0 » ;
 *  - en retard : une étape par semaine de retard (« R0 » du 1er au 7e jour,
 *    « R1 » du 8e au 14e…), jusqu'à ce que l'alerte soit traitée.
 *
 * La clé sert à n'envoyer chaque étape qu'une fois.
 */
export function reminderStep(due: Date | string, remindDays: number[], now = new Date()): { key: string; left: number } | null {
  const left = daysLeft(due, now);
  if (left < 0) return { key: `R${Math.floor((-left - 1) / 7)}`, left };
  if (left === 0) return { key: "J0", left };
  const reached = normalizeRemindDays(remindDays).filter(r => r > 0 && left <= r);
  if (!reached.length) return null;
  return { key: `J-${Math.min(...reached)}`, left };
}

/** « dans 7 jours », « demain », « aujourd'hui », « en retard de 3 jours ». */
export function dueWording(left: number): string {
  if (left === 0) return "aujourd'hui";
  if (left === 1) return "demain";
  if (left > 1) return `dans ${left} jours`;
  return left === -1 ? "en retard d'un jour" : `en retard de ${-left} jours`;
}

/**
 * Prochaine occurrence d'une alerte récurrente, ou null. `anchorDay` est le
 * quantième d'origine : sans lui, 31 janv. → 28 févr. → 28 mars (dérive).
 * Une occurrence déjà passée est créée telle quelle : chaque période reste une
 * obligation, la sauter masquerait un retard réel.
 */
export function nextOccurrence(due: Date | string, repeat: string | undefined, anchorDay?: number | null): Date | null {
  const months = repeat === "monthly" ? 1 : repeat === "quarterly" ? 3 : repeat === "yearly" ? 12 : 0;
  if (!months) return null;
  const d = new Date(due);
  if (isNaN(d.getTime())) return null;
  const day = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : d.getDate();
  const next = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes());
  // 31 janvier + 1 mois = 28 (ou 29) février, pas 3 mars.
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

/** Ton d'affichage : rouge en retard ou le jour même, orange sous 7 jours. */
export function alertTone(left: number): "neg" | "warn" | "info" {
  if (left <= 0) return "neg";
  if (left <= 7) return "warn";
  return "info";
}

/**
 * Date saisie (« 2026-12-14 ») fixée à midi, heure du serveur : un minuit UTC
 * pouvait basculer la veille selon le fuseau et décaler les rappels d'un jour.
 */
export function parseAlertDate(input: unknown): Date | null {
  let s: string;
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    s = `${input.getFullYear()}-${String(input.getMonth() + 1).padStart(2, "0")}-${String(input.getDate()).padStart(2, "0")}`;
  } else if (typeof input === "string") s = input.trim();
  else return null;
  // Jour seul : une heure ISO (« …T23:30:00Z ») ferait changer de jour selon le fuseau du serveur.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(s);
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, da, 12, 0, 0);
  // « 2026-02-30 » glissait au 2 mars : refusé.
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d;
}

/** Contrôle d'une saisie ; renvoie le message d'erreur ou null. */
export function checkAlertInput(b: { title?: unknown; dueDate?: unknown; category?: unknown; repeat?: unknown }): string | null {
  if (typeof b.title !== "string" || !b.title.trim()) return "Donnez un intitulé à l'alerte.";
  const due = parseAlertDate(b.dueDate);
  if (!due) return "Indiquez la date d'échéance.";
  const y = due.getFullYear();
  if (y < 2000 || y > 2100) return "Date d'échéance invalide.";
  if (b.category !== undefined && b.category !== "" && !isOwnKey(ALERT_CATEGORIES, b.category)) return "Catégorie inconnue.";
  if (b.repeat !== undefined && b.repeat !== "" && !isOwnKey(ALERT_REPEATS, b.repeat)) return "Périodicité inconnue.";
  return null;
}

/** Phrase complète : majuscule initiale, point final (la conséquence suit un point dans le rappel). */
export function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(cap) ? cap : `${cap}.`;
}

/** Message d'un rappel : l'intitulé y figure (deux alertes à la même date ne se confondent pas). */
export function alertReminderMessage(a: { title: string; dueDate: Date | string; consequence?: string | null }, left: number): { title: string; message: string } {
  const date = new Date(a.dueDate).toLocaleDateString("fr-FR");
  return {
    title: left < 0 ? `Alerte en retard : ${a.title}` : `Alerte : ${a.title}`,
    message: `« ${a.title} » : échéance le ${date} (${dueWording(left)}).${a.consequence ? ` ${sentence(a.consequence)}` : ""}`,
  };
}

/** Étapes qui partent aussi par e-mail : premier rappel, jour J, premier jour de retard. */
export function emailStep(key: string, remindDays: number[]): boolean {
  const first = normalizeRemindDays(remindDays).find(d => d > 0);
  return key === "J0" || key === "R0" || (first !== undefined && key === `J-${first}`);
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** E-mail de rappel d'une alerte. */
export function alertReminderEmail(firstName: string | undefined, a: { title: string; dueDate: Date | string; consequence?: string | null }, left: number, url: string): { subject: string; html: string; text: string } {
  const { title, message } = alertReminderMessage(a, left);
  const color = left <= 0 ? "#b42318" : "#b54708";
  const html = `<div style="font-family:Arial,sans-serif;color:#1c2230;max-width:560px">
<p>Bonjour${firstName ? ` ${escHtml(firstName)}` : ""},</p>
<p style="color:${color};font-weight:bold">${escHtml(message)}</p>
<p style="margin-top:20px"><a href="${escHtml(url)}" style="background:#3b5bdb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ouvrir l'alerte</a></p>
<p style="color:#6b7280;font-size:12px;margin-top:18px">Marquez l'alerte « traitée » dans Kanoo pour arrêter ses rappels.</p></div>`;
  const text = [`Bonjour${firstName ? ` ${firstName}` : ""},`, "", message, "", `Ouvrir : ${url}`, "", "Marquez l'alerte « traitée » dans Kanoo pour arrêter ses rappels."].join("\n");
  return { subject: title, html, text };
}
