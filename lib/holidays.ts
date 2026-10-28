/**
 * Jours fériés du Niger (chômés et payés), pour le décompte des congés.
 *
 * Fêtes civiles fixes, lundi de Pâques et Noël, et fêtes musulmanes. Ces
 * dernières suivent le calendrier lunaire : les dates ci-dessous sont les
 * dates prévisionnelles, que l'arrêté annuel du Gouvernement peut décaler d'un
 * jour. Chaque organisation peut ajouter ou retirer un jour (Réglages → RH).
 */

export interface Holiday { date: string; label: string }

const FIXED: Array<[string, string]> = [
  ["01-01", "Jour de l'An"],
  ["04-24", "Fête de la Concorde"],
  ["05-01", "Fête du Travail"],
  ["08-03", "Fête de l'Indépendance"],
  ["12-18", "Proclamation de la République"],
  ["12-25", "Noël"],
];

/** Fêtes musulmanes prévisionnelles (Laylat al-Qadr, Korité, Tabaski, Achoura… selon l'usage nigérien). */
const ISLAMIC: Record<number, Array<[string, string]>> = {
  2025: [["03-27", "Laylat al-Qadr"], ["03-31", "Aïd el-Fitr (Korité)"], ["06-07", "Aïd el-Adha (Tabaski)"], ["06-27", "Nouvel an musulman"], ["09-05", "Mouloud"]],
  2026: [["03-17", "Laylat al-Qadr"], ["03-20", "Aïd el-Fitr (Korité)"], ["05-27", "Aïd el-Adha (Tabaski)"], ["06-16", "Nouvel an musulman"], ["08-26", "Mouloud"]],
  2027: [["03-06", "Laylat al-Qadr"], ["03-10", "Aïd el-Fitr (Korité)"], ["05-17", "Aïd el-Adha (Tabaski)"], ["06-06", "Nouvel an musulman"], ["08-15", "Mouloud"]],
  2028: [["02-23", "Laylat al-Qadr"], ["02-27", "Aïd el-Fitr (Korité)"], ["05-05", "Aïd el-Adha (Tabaski)"], ["05-25", "Nouvel an musulman"], ["08-04", "Mouloud"]],
};

/** Dimanche de Pâques (algorithme de Meeus / Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Jours fériés d'une année, avec les ajouts / retraits de l'organisation. */
export function holidaysOf(year: number, custom: { extra?: Holiday[]; removed?: string[] } = {}): Holiday[] {
  const easterMonday = easterSunday(year); easterMonday.setDate(easterMonday.getDate() + 1);
  const list: Holiday[] = [
    ...FIXED.map(([md, label]) => ({ date: `${year}-${md}`, label })),
    { date: key(easterMonday), label: "Lundi de Pâques" },
    ...(ISLAMIC[year] ?? []).map(([md, label]) => ({ date: `${year}-${md}`, label })),
    ...(custom.extra ?? []).filter(h => h.date.startsWith(`${year}-`)),
  ];
  const removed = new Set(custom.removed ?? []);
  const seen = new Set<string>();
  return list.filter(h => !removed.has(h.date) && !seen.has(h.date) && seen.add(h.date)).sort((a, b) => a.date.localeCompare(b.date));
}

/** Ensemble des dates fériées couvrant une période (clés AAAA-MM-JJ). */
export function holidaySet(start: Date, end: Date, custom?: { extra?: Holiday[]; removed?: string[] }): Set<string> {
  const out = new Set<string>();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) for (const h of holidaysOf(y, custom)) out.add(h.date);
  return out;
}

export { key as dateKey };
