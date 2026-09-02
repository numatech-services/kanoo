"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

interface Stats { totalTenants: number; activeTenants: number; trialTenants: number; totalUsers: number; byType: Array<{_id: string; count: number}>; }

export default function SuperadminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/superadmin/stats", { credentials: "include" })
      .then(r => r.json()).then(d => setStats(d.data)).finally(() => setLoading(false));
  }, []);

  const kpis = stats ? [
    { label: "Organisations totales", value: stats.totalTenants, icon: "🏢", color: "bg-blue-50 text-blue-700" },
    { label: "Abonnements actifs", value: stats.activeTenants, icon: "✅", color: "bg-green-50 text-green-700" },
    { label: "Périodes d'essai", value: stats.trialTenants, icon: "⏱️", color: "bg-amber-50 text-amber-700" },
    { label: "Utilisateurs actifs", value: stats.totalUsers, icon: "👥", color: "bg-purple-50 text-purple-700" },
  ] : [];

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-ink">Plateforme Kanoo</h1><p className="text-sm text-moss mt-0.5">Vue superadmin — toutes les organisations</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {loading ? [...Array(4)].map((_,i)=><div key={i} className="h-24 bg-white rounded-xl border border-clay/20 animate-pulse"/>) :
          kpis.map(k => (
            <div key={k.label} className="bg-white rounded-xl border border-clay/20 p-5">
              <div className="flex items-start justify-between"><div><p className="text-xs text-moss font-medium uppercase tracking-wide">{k.label}</p><p className="text-3xl font-bold text-ink mt-1">{k.value}</p></div><span className={`text-2xl p-2 rounded-lg ${k.color}`}>{k.icon}</span></div>
            </div>
          ))
        }
      </div>
      {stats?.byType && (
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <h2 className="font-semibold text-ink mb-4">Répartition par profil</h2>
          <div className="flex gap-6">
            {stats.byType.map(t => (
              <div key={t._id} className="text-center"><p className="text-3xl font-bold text-ink">{t.count}</p><p className="text-sm text-moss capitalize mt-1">{t._id}</p></div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/saas/tenants" className="bg-white rounded-xl border border-clay/20 p-5 hover:shadow-soft transition-shadow">
          <h3 className="font-semibold text-ink mb-1">🏢 Gérer les organisations</h3>
          <p className="text-sm text-moss">Voir, créer, suspendre des tenants</p>
        </Link>
        <Link href="/saas/security" className="bg-white rounded-xl border border-clay/20 p-5 hover:shadow-soft transition-shadow">
          <h3 className="font-semibold text-ink mb-1">🔐 Sécurité & Accès</h3>
          <p className="text-sm text-moss">Matrice d'accès API, logs de sécurité</p>
        </Link>
      </div>
    </div>
  );
}
