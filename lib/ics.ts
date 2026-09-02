/** Génération d'un fichier iCalendar (.ics) « Ajouter au calendrier ». */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toIcsDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function esc(s: string): string {
  return (s || "").replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

export interface IcsOptions {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end?: Date;
  url?: string;
}

export function buildIcs(o: IcsOptions): string {
  const end = o.end || new Date(o.start.getTime() + 2 * 3600 * 1000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kanoo//Activites//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${o.uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(o.start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${esc(o.title)}`,
    o.description ? `DESCRIPTION:${esc(o.description)}` : "",
    o.location ? `LOCATION:${esc(o.location)}` : "",
    o.url ? `URL:${esc(o.url)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}
