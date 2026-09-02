"use client";

type StatusVariant =
  | "draft" | "sent" | "partial" | "paid" | "overdue" | "cancelled"
  | "active" | "inactive" | "suspended"
  | "pending" | "approved" | "rejected"
  | "trial" | "planning" | "published" | "attributed";

const STYLES: Record<StatusVariant, string> = {
  draft:      "bg-gray-100 text-gray-600",
  sent:       "bg-blue-100 text-blue-700",
  partial:    "bg-amber-100 text-amber-700",
  paid:       "bg-green-100 text-green-700",
  overdue:    "bg-red-100 text-red-700",
  cancelled:  "bg-gray-100 text-gray-400",
  active:     "bg-green-100 text-green-700",
  inactive:   "bg-gray-100 text-gray-500",
  suspended:  "bg-red-100 text-red-600",
  pending:    "bg-amber-100 text-amber-700",
  approved:   "bg-green-100 text-green-700",
  rejected:   "bg-red-100 text-red-600",
  trial:      "bg-purple-100 text-purple-700",
  planning:   "bg-sky-100 text-sky-700",
  published:  "bg-blue-100 text-blue-700",
  attributed: "bg-green-100 text-green-700",
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
  const cls = STYLES[s] || "bg-gray-100 text-gray-600";
  const txt = label || LABELS[s] || status;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {txt}
    </span>
  );
}
