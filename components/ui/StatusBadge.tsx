"use client";

import {
  FileEdit, Send, CircleDollarSign, CheckCircle2, AlertTriangle, Ban,
  Clock, ThumbsUp, ThumbsDown, Sparkles, CalendarClock, Megaphone, Award,
  PauseCircle, CircleSlash,
} from "lucide-react";
import type { PillTone } from "./Primitives";

type StatusVariant =
  | "draft" | "sent" | "partial" | "paid" | "overdue" | "cancelled"
  | "active" | "inactive" | "suspended"
  | "pending" | "approved" | "rejected"
  | "trial" | "planning" | "published" | "attributed"
  | "expiring" | "expired" | "closed" | "disputed";

interface Variant {
  tone: PillTone;
  label: string;
  Icon: typeof FileEdit;
}

/**
 * Vocabulaire d'état, en un seul endroit.
 *
 * Huit fichiers portaient leur propre table de correspondance : « Brouillon »
 * y était tantôt gris, tantôt ambre, et « Soldée » s'affichait en vert avec du
 * texte ambre — un fond et une encre qui ne parlaient pas de la même chose.
 *
 * L'icône n'est pas décorative. Elle permet de distinguer « réglée » de
 * « en retard » sans dépendre du vert et du rouge, que huit hommes sur cent ne
 * séparent pas, et rend l'état lisible sur une impression en noir et blanc.
 */
const VARIANTS: Record<StatusVariant, Variant> = {
  draft:      { tone: "mute", label: "Brouillon",      Icon: FileEdit },
  sent:       { tone: "info", label: "Émise",          Icon: Send },
  partial:    { tone: "warn", label: "Partiel",        Icon: CircleDollarSign },
  paid:       { tone: "pos",  label: "Soldée",         Icon: CheckCircle2 },
  overdue:    { tone: "neg",  label: "En retard",      Icon: AlertTriangle },
  cancelled:  { tone: "mute", label: "Annulée",        Icon: Ban },
  disputed:   { tone: "warn", label: "En litige",      Icon: CircleSlash },

  active:     { tone: "pos",  label: "Actif",          Icon: CheckCircle2 },
  inactive:   { tone: "mute", label: "Inactif",        Icon: PauseCircle },
  suspended:  { tone: "neg",  label: "Suspendu",       Icon: PauseCircle },

  pending:    { tone: "warn", label: "En attente",     Icon: Clock },
  approved:   { tone: "pos",  label: "Approuvé",       Icon: ThumbsUp },
  rejected:   { tone: "neg",  label: "Refusé",         Icon: ThumbsDown },

  trial:      { tone: "section", label: "Essai",       Icon: Sparkles },
  planning:   { tone: "info", label: "Planification",  Icon: CalendarClock },
  published:  { tone: "info", label: "Publiée",        Icon: Megaphone },
  attributed: { tone: "pos",  label: "Attribuée",      Icon: Award },

  expiring:   { tone: "warn", label: "À renouveler",   Icon: CalendarClock },
  expired:    { tone: "neg",  label: "Échu",           Icon: AlertTriangle },
  closed:     { tone: "mute", label: "Clos",           Icon: Ban },
};

interface StatusBadgeProps {
  status: string;
  /** Remplace l'intitulé sans toucher à la teinte ni à l'icône. */
  label?: string;
  /** Point plutôt qu'icône, quand la place manque dans un tableau dense. */
  compact?: boolean;
}

export function StatusBadge({ status, label, compact = false }: StatusBadgeProps) {
  const v = VARIANTS[status as StatusVariant];
  const tone = v?.tone ?? "mute";
  const text = label ?? v?.label ?? status;

  return (
    <span className={`pill pill-${tone} ${compact ? "pill-dot" : ""}`}>
      {!compact && v && <v.Icon size={11} strokeWidth={2.5} className="shrink-0" />}
      {text}
    </span>
  );
}

/** Intitulé seul — pour un export, un PDF, un titre de colonne. */
export function statusLabel(status: string): string {
  return VARIANTS[status as StatusVariant]?.label ?? status;
}
