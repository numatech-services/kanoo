"use client";

type StatusVariant =
  | "draft" | "sent" | "partial" | "paid" | "overdue" | "cancelled"
  | "active" | "inactive" | "suspended"
  | "pending" | "approved" | "rejected"
  | "trial" | "planning" | "published" | "attributed";

const STYLES: Record<StatusVariant, string> = {
  draft:      "bg-surface2 text-ink2",
  sent:       "bg-info-50 text-info",
  partial:    "bg-warn-50 text-warn",
  paid:       "bg-pos-50 text-pos",
  overdue:    "bg-neg-50 text-neg",
  cancelled:  "bg-surface2 text-ink3",
  active:     "bg-pos-50 text-pos",
  inactive:   "bg-surface2 text-ink3",
  suspended:  "bg-neg-50 text-neg",
  pending:    "bg-warn-50 text-warn",
  approved:   "bg-pos-50 text-pos",
  rejected:   "bg-neg-50 text-neg",
  trial:      "bg-section-soft text-section",
  planning:   "bg-info-50 text-info",
  published:  "bg-info-50 text-info",
  attributed: "bg-pos-50 text-pos",
};

const LABELS: Partial<Record<StatusVariant, string>> = {
  draft: "Brouillon", sent: "Émise", partial: "Partiel", paid: "Soldée",
  overdue: "En retard", cancelled: "Annulée", active: "Actif", inactive: "Inactif",
  suspended: "Suspendu", pending: "En attente", approved: "Approuvé",
  rejected: "Refusé", trial: "Essai", planning: "Planification",
  published: "Publiée", attributed: "Attribuée",
};

interface StatusBadgeProps {
  status: string;
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const s = status as StatusVariant;
  const cls = STYLES[s] || "bg-surface2 text-ink2";
  const txt = label || LABELS[s] || status;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {txt}
    </span>
  );
}
