"use client";
import { IfCan } from "@/components/shared/IfCan";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { SupplierForm } from "@/components/pme/SupplierForm";

interface Supplier { _id: string; code: string; name: string; nif?: string; phone?: string; email?: string; logo?: string; paymentTermDays: number; bankAccount?: string; isActive: boolean; }

export default function SuppliersPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(""); const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false); const [editing, setEditing] = useState<Supplier|null>(null);
  const LIMIT = 20;

  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400); return () => clearTimeout(t); }, [searchInput]);
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (search) params.set("search", search);
    const res = await fetch(`/api/suppliers?${params}`, { credentials: "include" });
    const d = await res.json(); setSuppliers(d.data?.items || []); setTotal(d.data?.pagination?.total || 0); setLoading(false);
  }, [page, search]);
  useEffect(() => { setMounted(true); load(); }, [load]);

  const columns: Column<Supplier>[] = [
    { key: "code", label: "Code", className: "font-mono text-xs w-24", sortable: true },
    {
      key: "name", label: "Fournisseur", sortable: true,
      render: (v, row) => (
        <span className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-md border border-line bg-surface2 grid place-items-center overflow-hidden shrink-0">
            {row.logo ? <img src={row.logo} alt="" className="max-w-full max-h-full object-contain" />
              : <span className="text-[11px] font-bold text-ink3">{String(v)?.[0]?.toUpperCase() || "?"}</span>}
          </span>
          <span className="font-medium text-ink">{String(v)}</span>
        </span>
      ),
    },
    { key: "nif", label: "NIF", className: "text-xs text-ink2" },
    { key: "phone", label: "Téléphone" },
    { key: "paymentTermDays", label: "Délai paiement", render: (v) => <span className="text-ink2">{String(v ?? "—")} j</span> },
    { key: "isActive", label: "Statut", render: (v) => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];


  async function handleSave(data: Partial<Supplier>) {
    const url = editing ? `/api/suppliers/${editing._id}` : "/api/suppliers";
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include", body: JSON.stringify(data) });
    setModalOpen(false); setEditing(null); load();
  }

  if (!mounted) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Fournisseurs</h1><p className="text-sm text-ink2 mt-0.5">{total} fournisseur{total > 1 ? "s" : ""}</p></div>
        <IfCan resource="suppliers">
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="px-4 py-2 bg-section text-white rounded-lg text-sm font-medium hover:brightness-95 transition-colors">+ Nouveau fournisseur</button>
        </IfCan>
      </div>
      <input type="text" placeholder="Rechercher…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="w-full max-w-sm px-4 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30" />
      <DataTable columns={columns} data={suppliers} loading={loading} keyExtractor={(s) => s._id} emptyMessage="Aucun fournisseur" onRowClick={(s) => router.push(`/suppliers/${s._id}`)} />
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} title={editing ? `Modifier — ${editing.name}` : "Nouveau fournisseur"} size="lg">
        <SupplierForm initial={editing||undefined} onSave={handleSave} onCancel={() => { setModalOpen(false); setEditing(null); }} />
      </Modal>
    </div>
  );
}
