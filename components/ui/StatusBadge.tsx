"use client";

import {
  FileEdit, Send, CircleDollarSign, CheckCircle2, AlertTriangle, Ban,
  Clock, ThumbsUp, ThumbsDown, Sparkles, CalendarClock, Megaphone, Award,
  PauseCircle, CircleSlash, Truck, PackageCheck, Printer, Hash, Loader, Undo2,
  Trophy, XCircle, Search, ListChecks, Banknote, Archive, UserCheck, RotateCcw, Hourglass,
} from "lucide-react";
import type { PillTone } from "./Primitives";

type StatusVariant = keyof typeof VARIANTS;

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
const VARIANTS = {
  draft:      { tone: "mute", label: "Brouillon",      Icon: FileEdit },
  sent:       { tone: "info", label: "Émise",          Icon: Send },
  partial:    { tone: "warn", label: "Partiel",        Icon: CircleDollarSign },
  paid:       { tone: "pos",  label: "Soldée",         Icon: CheckCircle2 },
  overdue:    { tone: "neg",  label: "En retard",      Icon: AlertTriangle },
  cancelled:  { tone: "mute", label: "Annulée",        Icon: Ban },
  written_off: { tone: "neg", label: "Irrécouvrable",  Icon: CircleSlash },
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

  // Ventes, achats, livraisons
  accepted:   { tone: "pos",  label: "Accepté",        Icon: ThumbsUp },
  confirmed:  { tone: "info", label: "Confirmée",      Icon: CheckCircle2 },
  invoiced:   { tone: "pos",  label: "Facturé",        Icon: CircleDollarSign },
  issued:     { tone: "info", label: "Émis",           Icon: Send },
  delivered:  { tone: "pos",  label: "Livré",          Icon: PackageCheck },
  partially_delivered: { tone: "warn", label: "Livré en partie", Icon: Truck },
  returned:   { tone: "warn", label: "Retourné",       Icon: Undo2 },
  received:   { tone: "pos",  label: "Reçu",           Icon: PackageCheck },
  partially_received: { tone: "warn", label: "Reçu en partie", Icon: Truck },
  validated:  { tone: "pos",  label: "Validé",         Icon: CheckCircle2 },
  effective:  { tone: "pos",  label: "Encaissé",       Icon: Banknote },
  renewed:    { tone: "pos",  label: "Renouvelé",      Icon: RotateCcw },
  reimbursed: { tone: "pos",  label: "Remboursée",     Icon: Banknote },
  submitted:  { tone: "info", label: "Soumis",         Icon: Send },
  completed:  { tone: "pos",  label: "Terminé",        Icon: CheckCircle2 },
  done:       { tone: "pos",  label: "Fait",           Icon: CheckCircle2 },
  final:      { tone: "pos",  label: "Définitif",      Icon: CheckCircle2 },
  late:       { tone: "neg",  label: "En retard",      Icon: AlertTriangle },
  collected:  { tone: "pos",  label: "Recouvrée",      Icon: Banknote },
  disposed:   { tone: "mute", label: "Cédée",          Icon: Archive },
  fully_depreciated: { tone: "mute", label: "Amortie", Icon: Archive },

  // Projets et agenda
  todo:       { tone: "mute", label: "À faire",        Icon: ListChecks },
  in_progress:{ tone: "info", label: "En cours",       Icon: Loader },
  on_hold:    { tone: "warn", label: "En pause",       Icon: PauseCircle },
  blocked:    { tone: "neg",  label: "Bloqué",         Icon: CircleSlash },
  planned:    { tone: "info", label: "Prévu",          Icon: CalendarClock },

  // Appels d'offres et candidatures
  identified: { tone: "mute", label: "Repéré",         Icon: Search },
  preparing:  { tone: "info", label: "En préparation", Icon: FileEdit },
  won:        { tone: "pos",  label: "Gagné",          Icon: Trophy },
  lost:       { tone: "neg",  label: "Perdu",          Icon: XCircle },
  bids_open:  { tone: "info", label: "Offres ouvertes", Icon: Megaphone },
  bids_closed:{ tone: "warn", label: "Offres closes",  Icon: Ban },
  evaluation: { tone: "info", label: "En évaluation",  Icon: Search },

  // Inventaires
  counting:   { tone: "info", label: "Comptage",       Icon: ListChecks },
  review:     { tone: "warn", label: "À valider",      Icon: Search },

  // Cartes ISIC
  processing: { tone: "info", label: "En traitement",  Icon: Loader },
  numbered:   { tone: "info", label: "Numérotée",      Icon: Hash },
  printing:   { tone: "info", label: "En impression",  Icon: Printer },
  printed:    { tone: "pos",  label: "Imprimée",       Icon: Printer },
  delivering: { tone: "info", label: "En livraison",   Icon: Truck },

  // Budget public
  en_attente: { tone: "warn", label: "En attente",     Icon: Clock },
  approuve:   { tone: "pos",  label: "Approuvé",       Icon: ThumbsUp },
  rejete:     { tone: "neg",  label: "Rejeté",         Icon: ThumbsDown },
  mandate:    { tone: "pos",  label: "Mandaté",        Icon: Banknote },
  ordered:    { tone: "info", label: "Ordonnancé",     Icon: Send },

  // Membres, participants, organisations
  expelled:   { tone: "neg",  label: "Exclu",          Icon: Ban },
  registered: { tone: "info", label: "Inscrit",        Icon: UserCheck },
  present:    { tone: "pos",  label: "Présent",        Icon: UserCheck },
  refunded:   { tone: "mute", label: "Remboursé",      Icon: Undo2 },
  pending_activation: { tone: "warn", label: "À activer", Icon: Hourglass },
  none:       { tone: "mute", label: "Aucun",          Icon: CircleSlash },
  open:       { tone: "info", label: "Ouvert",         Icon: Clock },
  resolved:   { tone: "pos",  label: "Résolu",         Icon: CheckCircle2 },
} satisfies Record<string, Variant>;

interface StatusBadgeProps {
  status: string;
  /** Remplace l'intitulé sans toucher à la teinte ni à l'icône. */
  label?: string;
  /** Point plutôt qu'icône, quand la place manque dans un tableau dense. */
  compact?: boolean;
}

export function StatusBadge({ status, label, compact = false }: StatusBadgeProps) {
  const v: Variant | undefined = VARIANTS[status as StatusVariant];
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
