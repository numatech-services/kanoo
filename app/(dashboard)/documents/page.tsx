"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";

interface Doc { _id: string; name: string; type?: string; size?: number; linkedTo?: string; url: string; createdAt: string; }

function formatSize(bytes?: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} Ko`;
  return `${(bytes/1024/1024).toFixed(1)} Mo`;
}

export default function DocumentsPage() {
  const [mounted, setMounted] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [linkedTo, setLinkedTo] = useState(""); const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (linkedTo) params.set("linkedTo", linkedTo);
    const res = await fetch(`/api/documents?${params}`, { credentials: "include" });
    const d = await res.json(); setDocs(d.data?.items || []); setTotal(d.data?.pagination?.total || 0); setLoading(false);
  }, [page, linkedTo]);
  useEffect(() => { setMounted(true); load(); }, [load]);

  if (!mounted) return null;

  const columns: Column<Doc>[] = [
    { key: "name", label: "Nom du fichier" },
    { key: "type", label: "Type", className: "text-xs text-moss uppercase" },
    { key: "size", label: "Taille", render: (v) => formatSize(Number(v)) },
    { key: "linkedTo", label: "Lié à", render: (v) => v ? <span className="text-xs bg-clay/20 px-2 py-0.5 rounded">{String(v)}</span> : "—" },
    { key: "createdAt", label: "Ajouté le", render: (v) => new Date(String(v)).toLocaleDateString("fr-FR") },
    { key: "url", label: "Télécharger", render: (v) => <a href={String(v)} target="_blank" rel="noopener noreferrer" className="text-cedar text-sm hover:underline" onClick={e=>e.stopPropagation()}>⬇ Télécharger</a> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Documents</h1><p className="text-sm text-moss mt-0.5">{total} document{total > 1 ? "s" : ""}</p></div>
      </div>
      <select value={linkedTo} onChange={e => { setLinkedTo(e.target.value); setPage(1); }} className="px-3 py-2 border border-clay/30 rounded-lg text-sm">
        <option value="">Tous les documents</option>
        {["invoices","contracts","marches","employees","approbations"].map(t=><option key={t} value={t}>{t}</option>)}
      </select>
      <DataTable columns={columns} data={docs} loading={loading} keyExtractor={(d) => d._id} emptyMessage="Aucun document" />
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
