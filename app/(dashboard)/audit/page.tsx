"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";

interface Log { _id: string; userEmail: string; userRole: string; action: string; resource: string; resourceId?: string; ip?: string; createdAt: string; }

const ACTION_COLORS: Record<string, string> = { CREATE:"bg-green-100 text-green-700", UPDATE:"bg-blue-100 text-blue-700", DELETE:"bg-red-100 text-red-700", LOGIN:"bg-purple-100 text-purple-700", PAYMENT:"bg-amber-100 text-amber-700", APPROVE:"bg-teal-100 text-teal-700", REJECT:"bg-red-100 text-red-700" };

export default function AuditPage() {
  const [mounted, setMounted] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [resource, setResource] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const LIMIT = 30;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (resource) params.set("resource", resource);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const res = await fetch(`/api/audit-logs?${params}`, { credentials: "include" });
    const d = await res.json(); setLogs(d.data?.items || []); setTotal(d.data?.pagination?.total || 0); setLoading(false);
  }, [page, resource, from, to]);
  useEffect(() => { setMounted(true); load(); }, [load]);

  if (!mounted) return null;

  const columns: Column<Log>[] = [
    { key: "createdAt", label: "Date/heure", render: (v) => <span className="text-xs text-moss">{new Date(String(v)).toLocaleString("fr-FR")}</span> },
    { key: "userEmail", label: "Utilisateur", className: "text-sm" },
    { key: "action", label: "Action", render: (v) => { const s = String(v); return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[s]||"bg-gray-100 text-gray-600"}`}>{s}</span>; } },
    { key: "resource", label: "Ressource", className: "text-sm text-moss" },
    { key: "resourceId", label: "ID ressource", className: "font-mono text-xs text-moss" },
    { key: "ip", label: "IP", className: "font-mono text-xs text-moss" },
  ];

  const inp = "px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold text-ink">Journal d'audit</h1><p className="text-sm text-moss mt-0.5">{total} entrée{total > 1 ? "s" : ""}</p></div>
      <div className="flex flex-wrap gap-3">
        <input placeholder="Filtrer par ressource…" value={resource} onChange={e => { setResource(e.target.value); setPage(1); }} className={inp} />
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} className={inp} />
        <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} className={inp} />
      </div>
      <DataTable columns={columns} data={logs} loading={loading} keyExtractor={(l) => l._id} emptyMessage="Aucun log d'audit" />
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
