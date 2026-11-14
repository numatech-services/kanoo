import type { TokenPayload } from "@/lib/auth";
import { keyDates } from "@/lib/key-dates";
import { holidaysOf } from "@/lib/holidays";
import { hrPolicy } from "@/lib/leaves";
import { authCan } from "@/lib/role-resources";
import { AlertModel } from "@/models/Alert";
import { alertScope } from "@/lib/alerts-server";

/**
 * Entrées d'agenda en lecture seule, calculées et non saisies : échéances des
 * marchés publics (lib/key-dates) et jours fériés du Niger retenus par
 * l'organisation (Réglages → RH et services). Elles s'ouvrent sur leur dossier.
 */
export const MARKET_CALENDAR = "Marchés publics";
export const HOLIDAY_CALENDAR = "Jours fériés";
// Nom peu susceptible d'être déjà pris par un calendrier saisi (réservé ci-dessous).
export const ALERT_CALENDAR = "Échéances (alertes Kanoo)";
/** Noms réservés : un événement saisi ne peut pas se faire passer pour une entrée calculée. */
export const RESERVED_CALENDARS = [MARKET_CALENDAR, HOLIDAY_CALENDAR, ALERT_CALENDAR];

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
  // Alertes ouvertes (Alertes et échéances), dans la portée du compte.
  if (authCan(auth, "alerts")) {
    const alerts = await AlertModel.find({ ...alertScope(auth), status: "open", dueDate: { $gte: from, $lt: to } })
      .select("title dueDate consequence").limit(500).lean<Array<{ _id: unknown; title: string; dueDate: Date; consequence?: string }>>();
    for (const a of alerts) {
      out.push({ _id: `alerte-${String(a._id)}`, title: `Échéance · ${a.title}`, type: "rappel", startAt: new Date(a.dueDate).toISOString(), allDay: true,
        visibility: "shared", calendar: ALERT_CALENDAR, virtual: true, href: `/alertes?alerte=${String(a._id)}`, description: a.consequence });
    }
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
