/**
 * Restauration de campus : les quantités suivent l'emploi du temps (calcul
 * pur, testé sans base, partagé avec l'écran).
 *
 *  - Un SERVICE est une plage de repas (petit-déjeuner, déjeuner, pause,
 *    dîner) avec un public de base toujours présent (résidents, personnel).
 *  - L'EMPLOI DU TEMPS liste les cours : jour, heures, groupe, effectif. Un
 *    groupe compte pour un service s'il a cours à moins d'une heure de la
 *    plage (il est sur le campus à ce moment-là) — une fois par service.
 *  - Les PÉRIODES (vacances, examens, jours fériés, événements) multiplient
 *    la présence (0,1 en vacances, 1,2 en examens, 2 pour une journée
 *    portes ouvertes…).
 *  - La consommation de chaque article est apprise sur l'historique : unités
 *    vendues par personne présente, service par service. La prévision d'un
 *    jour = présence attendue × consommation par personne, + marge.
 */

export interface Service { key: string; label: string; from: string; to: string; base?: number }
export interface Course {
  day: number; from: string; to: string; group: string; headcount: number;
  /** Validité du cours (AAAA-MM-JJ) : un planning de semestre donne « du 12.10 au 22.01 ». */
  start?: string; end?: string;
  /** Intitulé du cours (information). */
  label?: string;
}
export interface Period { from: string; to: string; label: string; kind: "holiday" | "exams" | "public_holiday" | "event" | "other"; factor: number }
export interface Schedule { services: Service[]; courses: Course[]; periods: Period[]; safetyMargin?: number }

export const DEFAULT_SERVICES: Service[] = [
  { key: "breakfast", label: "Petit-déjeuner", from: "06:30", to: "09:30", base: 0 },
  { key: "lunch", label: "Déjeuner", from: "11:30", to: "14:30", base: 0 },
  { key: "break", label: "Pause de l'après-midi", from: "15:00", to: "17:30", base: 0 },
  { key: "dinner", label: "Dîner", from: "18:30", to: "21:30", base: 0 },
];

export const PERIOD_KINDS: Record<Period["kind"], { label: string; factor: number }> = {
  holiday: { label: "Vacances", factor: 0.1 },
  exams: { label: "Examens", factor: 1.15 },
  public_holiday: { label: "Jour férié", factor: 0 },
  event: { label: "Événement", factor: 1.5 },
  other: { label: "Autre", factor: 1 },
};

export const DAYS_FR = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Marge d'un groupe autour d'un service (minutes) : il est sur le campus. */
const AROUND = 60;

/** Service (plage de repas) d'un instant, ou null hors service. */
export function serviceAt(at: Date, services: Service[]): Service | null {
  const t = at.getHours() * 60 + at.getMinutes();
  return services.find(s => t >= minutes(s.from) && t < minutes(s.to)) ?? null;
}

/** Facteur des périodes couvrant un jour (le plus fort écart à 1 l'emporte : un férié pendant les examens = 0). */
export function periodFactor(day: string, periods: Period[]): { factor: number; periods: Period[] } {
  const on = periods.filter(p => p.from <= day && day <= p.to);
  if (!on.length) return { factor: 1, periods: [] };
  const zero = on.find(p => p.factor === 0);
  if (zero) return { factor: 0, periods: on };
  return { factor: on.reduce((f, p) => f * p.factor, 1), periods: on };
}

/** Effectif attendu d'un service un jour donné : public de base + groupes en cours autour du service, × périodes. */
export function presenceFor(date: Date, service: Service, s: Schedule): { presence: number; groups: number; factor: number; periods: Period[] } {
  const dow = date.getDay();
  const a = minutes(service.from) - AROUND, b = minutes(service.to) + AROUND;
  const seen = new Map<string, number>();
  const today = dayKey(date);
  for (const c of s.courses) {
    if (c.day !== dow) continue;
    if ((c.start && today < c.start) || (c.end && today > c.end)) continue;
    if (minutes(c.to) <= a || minutes(c.from) >= b) continue;
    seen.set(c.group, Math.max(seen.get(c.group) ?? 0, c.headcount));
  }
  const students = [...seen.values()].reduce((t, n) => t + n, 0);
  const pf = periodFactor(dayKey(date), s.periods);
  return { presence: Math.round(((service.base ?? 0) + students) * pf.factor), groups: seen.size, factor: pf.factor, periods: pf.periods };
}

export interface SaleFact { at: Date; itemId: string; quantity: number }

/**
 * Consommation apprise : pour chaque article et chaque service, unités
 * vendues ÷ personnes présentes, sur les jours de l'historique où le service
 * avait du public. Les ventes hors service sont rattachées au service le plus
 * proche dans la journée.
 */
export function learnRates(facts: SaleFact[], s: Schedule, fromDay: string, toDay: string) {
  const services = s.services.length ? s.services : DEFAULT_SERVICES;
  const nearest = (at: Date) => serviceAt(at, services) ?? [...services].sort((x, y) => {
    const t = at.getHours() * 60 + at.getMinutes();
    const d = (v: Service) => Math.min(Math.abs(t - minutes(v.from)), Math.abs(t - minutes(v.to)));
    return d(x) - d(y);
  })[0];
  // Comptoir récent : l'apprentissage part de la première vente (les jours
  // d'avant, sans ticket, ne sont pas des jours sans consommation).
  const first = facts.reduce<string | null>((m, f) => { const d = dayKey(f.at); return !m || d < m ? d : m; }, null);
  if (first && first > fromDay) fromDay = first;
  const sold = new Map<string, number>();      // item|service → quantité
  const days = new Set<string>();              // jour|service où l'on a vendu
  for (const f of facts) {
    const sv = nearest(f.at);
    sold.set(`${f.itemId}|${sv.key}`, (sold.get(`${f.itemId}|${sv.key}`) ?? 0) + f.quantity);
    days.add(`${dayKey(f.at)}|${sv.key}`);
  }
  // Présence cumulée par service sur la période observée.
  const presence = new Map<string, number>();
  for (let d = new Date(`${fromDay}T12:00:00`); dayKey(d) <= toDay; d.setDate(d.getDate() + 1)) {
    for (const sv of services) {
      const p = presenceFor(d, sv, s).presence;
      // Jour sans présence prévue mais avec ventes : on compte au moins le
      // public réel minimal (1) pour ne pas diviser par zéro.
      presence.set(sv.key, (presence.get(sv.key) ?? 0) + (p > 0 ? p : days.has(`${dayKey(d)}|${sv.key}`) ? 1 : 0));
    }
  }
  const rates = new Map<string, number>();     // item|service → unités par personne
  for (const [k, q] of sold) {
    const p = presence.get(k.split("|")[1]) ?? 0;
    if (p > 0) rates.set(k, q / p);
  }
  return { rates, presence };
}

/** Quantités à préparer / prévoir pour un jour : présence × consommation par personne, + marge, arrondi supérieur. */
export function forecastDay(date: Date, s: Schedule, rates: Map<string, number>) {
  const services = s.services.length ? s.services : DEFAULT_SERVICES;
  const margin = 1 + Math.max(0, Math.min(1, s.safetyMargin ?? 0.1));
  const byService = services.map(sv => {
    const p = presenceFor(date, sv, s);
    const items: Array<{ itemId: string; quantity: number }> = [];
    for (const [k, r] of rates) {
      const [itemId, key] = k.split("|");
      if (key !== sv.key) continue;
      const q = Math.ceil(r * p.presence * margin - 1e-9);
      if (q > 0) items.push({ itemId, quantity: q });
    }
    return { service: sv, ...p, items };
  });
  const total = new Map<string, number>();
  for (const b of byService) for (const i of b.items) total.set(i.itemId, (total.get(i.itemId) ?? 0) + i.quantity);
  return { byService, total };
}

/** Lecture d'un emploi du temps CSV : jour ; début ; fin ; groupe ; effectif (jour en lettres ou 0-6). */
export function parseTimetableCsv(text: string): { courses: Course[]; errors: string[] } {
  const courses: Course[] = [], errors: string[] = [];
  const names = DAYS_FR.map(d => d.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""));
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const [k, raw] of lines.entries()) {
    const c = raw.split(raw.includes(";") ? ";" : ",").map(x => x.trim().replace(/^"|"$/g, ""));
    if (k === 0 && /jour/i.test(c[0])) continue;
    const dayRaw = (c[0] ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const day = /^\d$/.test(dayRaw) ? Number(dayRaw) : names.findIndex(n => n.startsWith(dayRaw.slice(0, 3)) && dayRaw.length >= 3);
    const from = (c[1] ?? "").replace("h", ":").padStart(5, "0"), to = (c[2] ?? "").replace("h", ":").padStart(5, "0");
    const headcount = Number(c[4]);
    if (!(day >= 0 && day <= 6) || !HHMM.test(from) || !HHMM.test(to) || minutes(to) <= minutes(from) || !c[3] || !(headcount > 0)) {
      errors.push(`Ligne ${k + 1} illisible : ${raw.slice(0, 60)}`); continue;
    }
    courses.push({ day, from, to, group: c[3].slice(0, 60), headcount: Math.round(headcount) });
  }
  return { courses, errors };
}

/** Contrôle d'un emploi du temps saisi à l'écran ; message d'erreur ou null. */
export function validateSchedule(s: Schedule): string | null {
  if (!Array.isArray(s.services) || !s.services.length || s.services.length > 8) return "De 1 à 8 services.";
  for (const v of s.services) {
    if (!v.key || !v.label || !HHMM.test(v.from) || !HHMM.test(v.to) || minutes(v.to) <= minutes(v.from)) return `Service « ${v.label || v.key} » : horaires invalides.`;
    if (v.base !== undefined && !(v.base >= 0)) return `Service « ${v.label} » : public de base invalide.`;
  }
  if (new Set(s.services.map(v => v.key)).size !== s.services.length) return "Deux services ont la même clé.";
  if (!Array.isArray(s.courses) || s.courses.length > 2000) return "Emploi du temps trop long (2 000 cours au plus).";
  for (const c of s.courses) {
    if (!(c.day >= 0 && c.day <= 6) || !HHMM.test(c.from) || !HHMM.test(c.to) || minutes(c.to) <= minutes(c.from) || !c.group || !(c.headcount > 0)) return `Cours « ${c.group || "?"} » : jour, horaires ou effectif invalides.`;
    if ((c.start && !/^\d{4}-\d{2}-\d{2}$/.test(c.start)) || (c.end && !/^\d{4}-\d{2}-\d{2}$/.test(c.end)) || (c.start && c.end && c.end < c.start)) return `Cours « ${c.group} » : dates de validité invalides.`;
  }
  for (const p of s.periods ?? []) if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.to) || p.to < p.from || !(p.factor >= 0 && p.factor <= 5)) return `Période « ${p.label || "?"} » : dates ou coefficient invalides.`;
  if (s.safetyMargin !== undefined && !(s.safetyMargin >= 0 && s.safetyMargin <= 1)) return "Marge de sécurité invalide (0 à 100 %).";
  return null;
}
