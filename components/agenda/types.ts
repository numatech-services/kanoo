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
}

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
