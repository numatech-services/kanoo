"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Alert {
  id: string;
  type: "overdue" | "expiry" | "stock" | "approval" | "fiscal";
  message: string;
  href: string;
  severity: "high" | "medium" | "low";
}

const SEVERITY_STYLES = {
  high:   "border-l-4 border-red-400 bg-red-50",
  medium: "border-l-4 border-amber-400 bg-amber-50",
  low:    "border-l-4 border-blue-400 bg-blue-50",
};

const SEVERITY_ICONS = { high: "🔴", medium: "🟡", low: "🔵" };

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/notifications?type=alert&limit=10", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAlerts(d.data?.items || []))
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-xl border border-clay/20 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-ink">Alertes</h2>
        <Link href="/notifications" className="text-xs text-cedar hover:underline">
          Tout voir →
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 bg-sand rounded animate-pulse" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="text-center py-8">
          <span className="text-3xl">✅</span>
          <p className="text-sm text-moss mt-2">Aucune alerte active</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <Link
              key={alert.id}
              href={alert.href}
              className={`block p-3 rounded-lg text-sm transition-opacity hover:opacity-80 ${SEVERITY_STYLES[alert.severity]}`}
            >
              <span className="mr-2">{SEVERITY_ICONS[alert.severity]}</span>
              {alert.message}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
