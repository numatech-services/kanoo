"use client";
import { useCallback, useEffect, useState } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";

interface BillingRow {
  _id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  trialEndsAt?: string;
  subscriptionEndsAt?: string;
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-pos-50 text-pos",
  trial: "bg-warn-50 text-warn",
  suspended: "bg-neg-50 text-neg",
  cancelled: "bg-neg-50 text-neg",
};

export default function BillingPage() {
  const [tenants, setTenants] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    // La liste était filtrée sur `status=trial` alors que l'écran affiche les
    // compteurs « Actifs » et « Suspendus » : ils valaient donc toujours zéro.
    fetch("/api/superadmin/tenants?limit=50", { credentials: "include" })
      .then(r => r.json())
      .then(d => setTenants(d.data?.items || []))
      .catch(() => setError("Chargement impossible."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Les boutons « Activer » et « Suspendre » n'avaient aucun gestionnaire : ils
   * étaient purement décoratifs. Ils appellent maintenant la route superadmin.
   */
  async function setStatus(id: string, subscriptionStatus: "active" | "suspended") {
    setBusyId(id);
    setError(null);
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`/api/superadmin/tenants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ subscriptionStatus }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Mise à jour refusée.");
      setTenants(prev => prev.map(t => (t._id === id ? { ...t, subscriptionStatus } : t)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mise à jour impossible.");
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<BillingRow>[] = [
    { key: "name", label: "Organisation" },
    { key: "plan", label: "Plan", className: "text-xs text-section font-mono" },
    {
      key: "subscriptionStatus", label: "Statut",
      render: (v) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[String(v)] || "bg-surface2 text-ink2"}`}>
          {String(v)}
        </span>
      ),
    },
    {
      key: "trialEndsAt", label: "Fin essai",
      render: (v) => (v ? new Date(String(v)).toLocaleDateString("fr-FR") : "—"),
    },
    {
      key: "subscriptionEndsAt", label: "Fin abonnement",
      render: (v) => (v ? new Date(String(v)).toLocaleDateString("fr-FR") : "—"),
    },
    {
      key: "_id", label: "Actions",
      render: (_v, row) => {
        const busy = busyId === row._id;
        return (
          <div className="flex gap-1">
            <button
              onClick={() => setStatus(row._id, "active")}
              disabled={busy || row.subscriptionStatus === "active"}
              className="px-2 py-1 bg-pos text-white text-xs rounded hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Activer
            </button>
            <button
              onClick={() => setStatus(row._id, "suspended")}
              disabled={busy || row.subscriptionStatus === "suspended"}
              className="px-2 py-1 bg-neg text-white text-xs rounded hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Suspendre
            </button>
          </div>
        );
      },
    },
  ];

  const count = (status: string) => tenants.filter(t => t.subscriptionStatus === status).length;
  const cards = [
    { label: "Périodes d'essai", value: count("trial"), color: "text-warn" },
    { label: "Actifs", value: count("active"), color: "text-pos" },
    { label: "Suspendus", value: count("suspended"), color: "text-neg" },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">Facturation &amp; Abonnements</h1>

      {error && (
        <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-surface rounded-xl border border-line p-4">
            <p className="text-xs text-ink2">{c.label}</p>
            <p className={`text-3xl font-bold mt-1 tabular-nums ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <DataTable columns={columns} data={tenants} loading={loading}
        keyExtractor={t => t._id} emptyMessage="Aucune organisation" />
    </div>
  );
}
