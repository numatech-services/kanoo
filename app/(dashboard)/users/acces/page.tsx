"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Search, ArrowLeft } from "lucide-react";
import { accessibleResourcesForRoles, type RoleLevels } from "@/lib/role-resources";
import { accessChip } from "@/components/users/AccessEditor";

/** Domaines qui relèvent des finances (gérant et comptabilité uniquement). */
const FINANCE_RESOURCES = ["invoices", "payments", "treasuryAccounts", "accountingEntries", "fiscalDeclarations",
  "fixedAssets", "recurringCharges", "payslips", "analytics", "isicFinance"];
import { resourceLabel } from "@/lib/resource-labels";
import type { UserRole } from "@/types";

interface U {
  _id: string; firstName?: string; lastName?: string; email?: string;
  role: string; roles?: string[]; roleLevels?: Record<string, string>; isActive?: boolean; allowedResources?: string[];
}

export default function AccessSummaryPage() {
  const [users, setUsers] = useState<U[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/users?limit=500", { credentials: "include" })
      .then(r => r.json())
      .then(d => setUsers(d.data?.items || []))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => users.map(u => {
    const roles = (u.roles?.length ? u.roles : [u.role]) as UserRole[];
    const resources = accessibleResourcesForRoles(roles, u.allowedResources, u.roleLevels as RoleLevels | undefined);
    const finance = resources.includes("*") || resources.some(r => FINANCE_RESOURCES.includes(r));
    // Dédoublonne les libellés (isic/isicFinance ont des libellés distincts, mais
    // livraisons/deliveries partagent le même — on ne veut pas de doublon visuel).
    const domains = [...new Set(resources.map(resourceLabel))].sort((a, b) => a.localeCompare(b, "fr"));
    const financeDomains = new Set(resources.filter(r => FINANCE_RESOURCES.includes(r)).map(resourceLabel));
    return { u, roles, domains, finance, financeDomains };
  }), [users]);

  const filtered = rows.filter(({ u }) =>
    `${u.firstName} ${u.lastName} ${u.email} ${u.role}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/users" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={13} /> Utilisateurs</Link>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2 mt-1"><ShieldCheck size={22} /> Synthèse des accès</h1>
        <p className="text-sm text-ink2">Qui accède à quoi. Les domaines découlent des rôles assignés ; pour les modifier, changez les rôles de la personne sur l'écran Utilisateurs.</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" size={15} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une personne…"
          className="w-full pl-9 pr-3 h-10 rounded-lg border border-line bg-surface text-sm" />
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-20 surface-card animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink3">Aucune personne.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ u, roles, domains, finance, financeDomains }) => (
            <div key={u._id} className="surface-card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-ink">{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
                    {u.isActive === false && <span className="ml-2 text-[11px] text-neg">(inactif)</span>}</p>
                  <p className="text-xs text-ink2">{u.email}</p>
                  {finance && <p className="mt-1 text-[11px] font-semibold text-neg">Accès aux informations financières</p>}
                </div>
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {roles.map(r => (
                    <span key={r} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-section-soft text-section">
                      {accessChip(r, u.roleLevels?.[r])}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-line flex gap-1.5 flex-wrap">
                {domains.includes("Tout (superadmin)") ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-warn-50 text-warn border border-warn/25 font-semibold">Accès total (superadmin)</span>
                ) : domains.length === 0 ? (
                  <span className="text-xs text-ink3 italic">Aucun domaine — accès très restreint.</span>
                ) : domains.map(d => (
                  <span key={d} className={`text-[11px] px-2 py-0.5 rounded-full border ${financeDomains.has(d) ? "bg-neg-50 text-neg border-neg/25 font-semibold" : "bg-surface2 text-ink2 border-line"}`}>{d}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
