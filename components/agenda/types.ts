export type AgendaType = "reunion" | "activite" | "tache" | "rappel" | "autre";

export interface AgendaItem {
  _id: string;
  title: string;
  description?: string;
  type: AgendaType;
  startAt: string;
  endAt?: string;
  allDay?: boolean;
  location?: string;
  meetingLink?: string;
  color?: string;
  visibility: "personal" | "shared";
  status?: "planned" | "done" | "cancelled";
  shareToken?: string;
  ownerId?: { _id?: string; firstName?: string; lastName?: string } | string;
  participants?: Array<{ _id?: string; firstName?: string; lastName?: string }>;
  /** Agenda d'équipe (« Direction », « Équipe commerciale »…). */
  calendar?: string;
  /** Entrée calculée (échéance de marché, jour férié) : lecture seule, s'ouvre sur `href`. */
  virtual?: boolean;
  href?: string;
}

/** Couleurs des agendas : fixes pour les agendas connus, puis une palette stable par nom. */
const CALENDAR_COLORS: Record<string, string> = {
  "Mon agenda": "#2F59DF", "Équipe commerciale": "#7C3AAD", "Direction": "#B7791F",
  "Marchés publics": "#C2272D", "Jours fériés": "#1C7A4C", "Partagés": "#0E7490",
};
const PALETTE = ["#0E7490", "#BE185D", "#4D7C0F", "#9A3412", "#4338CA", "#0F766E"];
export function calendarColor(name: string): string {
  if (CALENDAR_COLORS[name]) return CALENDAR_COLORS[name];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
/** Agendas d'équipe proposés à la saisie (en plus de ceux déjà utilisés). */
export const SUGGESTED_CALENDARS = ["Équipe commerciale", "Direction", "Administration", "Technique"];

/** Libellé + couleur par type (couleurs catégorielles, indépendantes du thème). */
export const TYPE_META: Record<AgendaType, { label: string; color: string }> = {
  reunion: { label: "Réunion", color: "#3755BD" },
  activite: { label: "Activité", color: "#1C5D4C" },
  tache: { label: "Tâche", color: "#8F5A2E" }, // contraste ≥ 4,5 avec le texte blanc
  rappel: { label: "Rappel", color: "#7C3AAD" },
  autre: { label: "Autre", color: "#6B7280" },
};

export function itemColor(it: { type: AgendaType; color?: string }): string {
  return it.color || TYPE_META[it.type]?.color || TYPE_META.autre.color;
}

export function ownerName(o: AgendaItem["ownerId"]): string {
  if (!o || typeof o === "string") return "";
  return [o.firstName, o.lastName].filter(Boolean).join(" ");
}
