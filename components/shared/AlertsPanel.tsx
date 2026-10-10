"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { notificationHref } from "@/lib/notification-link";

interface Notice { _id: string; type?: string; title?: string; message: string; linkedTo?: string; linkedId?: string | null; createdAt?: string }

// Gravité selon la nature de l'alerte : un impayé ou une rupture passent avant une échéance.
const HIGH = new Set(["invoice_overdue", "stock_alert", "courrier_due"]);
const MEDIUM = new Set(["contract_expiry", "employee_contract_expiry", "expense_due", "fiscal_reminder", "admin_document"]);
const SEVERITY_STYLES = {
  high: "border-l-4 border-neg/40 bg-neg-50",
  medium: "border-l-4 border-warn/40 bg-warn-50",
  low: "border-l-4 border-info/40 bg-info-50",
};

/**
 * Alertes du tableau de bord : les notifications non lues de l'utilisateur,
 * chacune menant à l'écran concerné (facture en retard, article sous le seuil…).
 * Le panneau lisait des champs que l'API ne renvoie pas (`href`, `severity`) :
 * aucun lien ne fonctionnait.
 */
export function AlertsPanel() {
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/notifications?unread=true&limit=8", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setItems(d?.data?.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-surface rounded-xl border border-line p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-ink">Alertes</h2>
        <Link href="/notifications" className="text-xs text-section hover:underline">Tout voir →</Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-surface2 rounded animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-ink2">Aucune alerte en attente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const severity = HIGH.has(n.type ?? "") ? "high" : MEDIUM.has(n.type ?? "") ? "medium" : "low";
            const href = notificationHref({ type: n.type, linkedTo: n.linkedTo, linkedId: n.linkedId ?? null }) ?? "/notifications";
            return (
              <Link key={n._id} href={href} className={`block p-3 rounded-lg text-sm transition-opacity hover:opacity-80 ${SEVERITY_STYLES[severity]}`}>
                {n.title && <span className="block font-semibold text-ink">{n.title}</span>}
                <span className="text-ink2">{n.message}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
