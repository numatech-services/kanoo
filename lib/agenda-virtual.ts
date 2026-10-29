import type { TokenPayload } from "@/lib/auth";
import { keyDates } from "@/lib/key-dates";
import { holidaysOf } from "@/lib/holidays";
import { hrPolicy } from "@/lib/leaves";

/**
 * Entrées d'agenda en lecture seule, calculées et non saisies : échéances des
 * marchés publics (lib/key-dates) et jours fériés du Niger retenus par
 * l'organisation (Réglages → RH et services). Elles s'ouvrent sur leur dossier.
 */
export const MARKET_CALENDAR = "Marchés publics";
export const HOLIDAY_CALENDAR = "Jours fériés";
/** Noms réservés : un événement saisi ne peut pas se faire passer pour une entrée calculée. */
export const RESERVED_CALENDARS = [MARKET_CALENDAR, HOLIDAY_CALENDAR];

export interface VirtualAgendaItem {
  _id: string; title: string; type: "rappel" | "autre"; startAt: string; allDay: true;
  visibility: "shared"; calendar: string; virtual: true; href?: string; description?: string;
}

export async function virtualAgenda(auth: TokenPayload, from: Date, to: Date): Promise<VirtualAgendaItem[]> {
  const out: VirtualAgendaItem[] = [];
  for (const k of await keyDates(auth, from, to)) {
    out.push({ _id: `kd-${k.id}`, title: `${k.label} · ${k.title}`, type: "rappel", startAt: k.date, allDay: true, visibility: "shared",
      calendar: MARKET_CALENDAR, virtual: true, href: k.href, description: [k.detail, k.owner ? `Responsable : ${k.owner}` : ""].filter(Boolean).join(" — ") });
  }
  const custom = (await hrPolicy(auth.tenantId)).holidays;
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
    for (const h of holidaysOf(y, custom)) {
      const d = new Date(`${h.date}T00:00:00`);
      if (d < from || d >= to) continue;
      out.push({ _id: `ferie-${h.date}`, title: h.label, type: "autre", startAt: d.toISOString(), allDay: true, visibility: "shared", calendar: HOLIDAY_CALENDAR, virtual: true });
    }
  }
  return out;
}
