/**
 * Lecture d'un planning de cours en PDF (format des plannings de semestre
 * d'écoles comme Swiss UMEF : en-tête « Classe / Programme / Année /
 * Planning valable du … au … », puis un tableau Dates | Cours | Jour |
 * Heures | Professeur). Calcul pur sur le texte positionné de chaque page
 * (lib/timetable-pdf-server.ts l'extrait) : testé sans PDF.
 *
 * Le texte d'un PDF n'arrive pas dans l'ordre de lecture (une page peut
 * donner toutes les dates, puis tous les cours) : les lignes du tableau se
 * reconstituent par la POSITION. Chaque ligne commence par une plage de
 * dates ; un intitulé sur deux lignes est rattaché à la plage la plus proche.
 */
import type { Course, Period } from "@/lib/campus";

export interface TextItem { s: string; x: number; y: number; page: number }

export interface PlanningEntry {
  from: string; to: string; course: string;
  days: number[];
  /** Plages horaires « 08h30 à 10h30 et 11h00 à 12h30 ». */
  slots: Array<{ from: string; to: string }>;
  kind: "course" | "exams" | "revision" | "welcome";
}
export interface Planning {
  className: string; program?: string; school?: string; year?: string; firstYear: boolean;
  validFrom?: string; validTo?: string;
  entries: PlanningEntry[];
  /** Pauses entre deux plages d'une même demi-journée (créneaux de vente). */
  breaks: Array<{ from: string; to: string }>;
  warnings: string[];
}

const DATE_RANGE = /(\d{2})\.(\d{2})\.(\d{4})\s*au\s*(\d{2})\.(\d{2})\.(\d{4})/;
const HOURS = /(\d{1,2})h(\d{2})\s*à\s*(\d{1,2})h(\d{2})/g;
const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const DAYS_RX = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)([\s,]+(et|au|à)?\s*(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche))*$/i;
const PROF = /^(dr|pr|m|mme|mlle|prof)\.?\s/i;

const iso = (d: string, m: string, y: string) => `${y}-${m}-${d}`;
const hhmm = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

/** « Lundi au vendredi », « Lundi et jeudi », « Lundi,mardi,jeudi et vendredi » → jours (0 = dimanche). */
export function parseDays(text: string): number[] {
  const t = norm(text).replace(/,/g, " , ");
  const words = t.split(/\s+/).filter(Boolean);
  const out = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    const d = DAY_NAMES.indexOf(words[i]);
    if (d < 0) continue;
    if ((words[i + 1] === "au" || words[i + 1] === "a") && DAY_NAMES.includes(words[i + 2])) {
      const e = DAY_NAMES.indexOf(words[i + 2]);
      for (let k = d; ; k = (k + 1) % 7) { out.add(k); if (k === e) break; }
      i += 2;
    } else out.add(d);
  }
  return [...out].sort((a, b) => (a || 7) - (b || 7));
}

/** « 08h30 à 10h30 et 11h00 à 12h30 » → plages. */
export function parseSlots(text: string): Array<{ from: string; to: string }> {
  return [...text.matchAll(HOURS)].map(m => ({ from: hhmm(m[1], m[2]), to: hhmm(m[3], m[4]) }));
}

/** Reconstitue les lignes du tableau et l'en-tête d'un planning. */
export function parsePlanningItems(items: TextItem[]): Planning {
  const warnings: string[] = [];
  const rows = new Map<string, TextItem[]>();
  for (const it of items) {
    if (!it.s.trim()) continue;
    const key = [...rows.keys()].find(k => { const [p, y] = k.split(":").map(Number); return p === it.page && Math.abs(y - it.y) <= 2; }) ?? `${it.page}:${it.y}`;
    rows.set(key, [...(rows.get(key) ?? []), it]);
  }
  const lines = [...rows.entries()].map(([k, its]) => {
    const [page, y] = k.split(":").map(Number);
    return { page, y, items: its.sort((a, b) => a.x - b.x), text: its.sort((a, b) => a.x - b.x).map(i => i.s.trim()).join(" ") };
  }).sort((a, b) => a.page - b.page || b.y - a.y);

  const field = (label: RegExp) => { const l = lines.find(x => label.test(x.text)); return l ? l.text.replace(label, "").trim() : undefined; };
  const className = field(/^classe\s*:\s*/i) ?? "";
  const program = field(/^programme\s*:\s*/i);
  const school = field(/^[ée]cole\s*:\s*/i);
  const year = field(/^ann[ée]e\s*:\s*/i);
  const valid = lines.find(l => /planning valable/i.test(l.text))?.text.match(DATE_RANGE);

  // Lignes du tableau : celles qui commencent par une plage de dates.
  const anchors = lines.filter(l => l.items[0] && DATE_RANGE.test(l.items[0].s) && !/valable/i.test(l.text));
  const cells = new Map(anchors.map(a => [a, [] as TextItem[]]));
  for (const l of lines) {
    if (anchors.includes(l)) { cells.get(l)!.push(...l.items.slice(1)); continue; }
    // Suite d'un intitulé sur plusieurs lignes : rattachée à la plage la plus proche de la même page.
    const near = anchors.filter(a => a.page === l.page && Math.abs(a.y - l.y) <= 20).sort((a, b) => Math.abs(a.y - l.y) - Math.abs(b.y - l.y))[0];
    if (near && !/^(classe|programme|ann[ée]e|section|[ée]cole|planning|dates\b|niamey)/i.test(l.text)) cells.get(near)!.push(...l.items.map(i => ({ ...i, s: i.s, y: l.y })));
  }

  const entries: PlanningEntry[] = [];
  for (const a of anchors) {
    const d = a.items[0].s.match(DATE_RANGE)!;
    const its = cells.get(a)!;
    const daysCell = its.find(i => DAYS_RX.test(norm(i.s).replace(/,/g, ", ")));
    const hoursText = its.filter(i => /\d{1,2}h\d{2}\s*à/.test(i.s)).map(i => i.s).join(" et ");
    // Intitulé : le reste, hors professeur, de haut en bas.
    const course = its.filter(i => i !== daysCell && !/\d{1,2}h\d{2}\s*à/.test(i.s) && !PROF.test(i.s.trim()) && i.x < (daysCell?.x ?? Infinity))
      .sort((p, q) => q.y - p.y || p.x - q.x).map(i => i.s.trim()).join(" ").replace(/\s+/g, " ").trim();
    const slots = parseSlots(hoursText);
    const days = daysCell ? parseDays(daysCell.s) : [];
    const n = norm(course);
    const kind: PlanningEntry["kind"] = /revision/.test(n) ? "revision" : /^examens?\b/.test(n) ? "exams" : /accueil/.test(n) ? "welcome" : "course";
    if (kind === "course" && (!slots.length || !days.length)) warnings.push(`« ${course || "?"} » (${d[1]}.${d[2]} au ${d[4]}.${d[5]}) : jours ou heures illisibles, à compléter.`);
    entries.push({ from: iso(d[1], d[2], d[3]), to: iso(d[4], d[5], d[6]), course: course || "Cours", days, slots, kind });
  }
  if (!className) warnings.push("Classe introuvable dans l'en-tête : nommez le groupe.");
  if (!entries.length) warnings.push("Aucune ligne de cours reconnue.");

  const breaks = new Map<string, { from: string; to: string }>();
  for (const e of entries) for (let i = 1; i < e.slots.length; i++) {
    const gap = { from: e.slots[i - 1].to, to: e.slots[i].from };
    if (gap.from < gap.to) breaks.set(`${gap.from}-${gap.to}`, gap);
  }
  return {
    className, program, school, year, firstYear: /premi[eè]re|1re|1ère|\bL1\b/i.test(year ?? "") || /premi[eè]re/i.test(className),
    validFrom: valid ? iso(valid[1], valid[2], valid[3]) : undefined, validTo: valid ? iso(valid[4], valid[5], valid[6]) : undefined,
    entries, breaks: [...breaks.values()].sort((a, b) => a.from.localeCompare(b.from)), warnings,
  };
}

/** Pour la présence, les plages d'une demi-journée (pause de moins d'une heure) n'en font qu'une. */
function mergeSlots(slots: Array<{ from: string; to: string }>) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const out: Array<{ from: string; to: string }> = [];
  for (const s of [...slots].sort((a, b) => a.from.localeCompare(b.from))) {
    const last = out[out.length - 1];
    if (last && m(s.from) - m(last.to) <= 60) last.to = s.to > last.to ? s.to : last.to;
    else out.push({ ...s });
  }
  return out;
}

/** Horaires supposés pour la révision et les examens (le planning n'en donne pas) : les matinées du lundi au vendredi. */
export const EXAM_HOURS = { from: "08:30", to: "12:30" };

/**
 * Cours de l'emploi du temps du comptoir pour une classe (effectif saisi),
 * et périodes de révision et d'examens (communes aux classes du campus).
 */
export function planningToSchedule(p: Planning, group: string, headcount: number): { courses: Course[]; periods: Period[] } {
  const courses: Course[] = [];
  const periods: Period[] = [];
  for (const e of p.entries) {
    if (e.kind === "exams" || e.kind === "revision") {
      for (const day of [1, 2, 3, 4, 5]) courses.push({ day, ...EXAM_HOURS, group, headcount, start: e.from, end: e.to, label: e.course });
      periods.push(e.kind === "exams"
        ? { from: e.from, to: e.to, label: "Examens", kind: "exams", factor: 1 }
        : { from: e.from, to: e.to, label: "Révision d'examens", kind: "other", factor: 0.6 });
      continue;
    }
    for (const day of e.days) for (const s of mergeSlots(e.slots)) courses.push({ day, from: s.from, to: s.to, group, headcount, start: e.from, end: e.to, label: e.course });
  }
  return { courses, periods };
}
