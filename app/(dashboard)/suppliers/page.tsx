"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";

interface Supplier { _id: string; code: string; name: string; nif?: string; phone?: string; email?: string; paymentTermDays: number; bankAccount?: string; isActive: boolean; }

export default function SuppliersPage() {
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
    { key: "name", label: "Fournisseur", sortable: true },
    { key: "nif", label: "NIF", className: "text-xs text-moss" },
    { key: "phone", label: "Téléphone" },
    { key: "paymentTermDays", label: "Délai paiement", render: (v) => <span className="text-moss">{v} j</span> },
    { key: "isActive", label: "Statut", render: (v) => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  const inp = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const lbl = "block text-xs font-medium text-moss mb-1";

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
        <div><h1 className="text-2xl font-bold text-ink">Fournisseurs</h1><p className="text-sm text-moss mt-0.5">{total} fournisseur{total > 1 ? "s" : ""}</p></div>
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors">+ Nouveau fournisseur</button>
      </div>
      <input type="text" placeholder="Rechercher…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="w-full max-w-sm px-4 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30" />
      <DataTable columns={columns} data={suppliers} loading={loading} keyExtractor={(s) => s._id} emptyMessage="Aucun fournisseur" onRowClick={(s) => { setEditing(s); setModalOpen(true); }} />
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} title={editing ? `Modifier — ${editing.name}` : "Nouveau fournisseur"} size="lg">
        <SupplierForm initial={editing||undefined} onSave={handleSave} onCancel={() => { setModalOpen(false); setEditing(null); }} />
      </Modal>
    </div>
  );
}

function SupplierForm({ initial, onSave, onCancel }: { initial?: Partial<Supplier>; onSave: (d: Partial<Supplier>) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState({ code: initial?.code||"", name: initial?.name||"", nif: initial?.nif||"", phone: initial?.phone||"", email: initial?.email||"", paymentTermDays: initial?.paymentTermDays??30, bankAccount: initial?.bankAccount||"", isActive: initial?.isActive??true });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const lbl = "block text-xs font-medium text-moss mb-1";
  return (
    <form onSubmit={async (e) => { e.preventDefault(); setSaving(true); await onSave(form); setSaving(false); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><label className={lbl}>Code *</label><input className={inp} value={form.code} onChange={(e) => setForm(p=>({...p,code:e.target.value}))} required /></div>
        <div><label className={lbl}>NIF</label><input className={inp} value={form.nif} onChange={(e) => setForm(p=>({...p,nif:e.target.value}))} /></div>
      </div>
      <div><label className={lbl}>Nom / Raison sociale *</label><input className={inp} value={form.name} onChange={(e) => setForm(p=>({...p,name:e.target.value}))} required /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={lbl}>Téléphone</label><input className={inp} value={form.phone} onChange={(e) => setForm(p=>({...p,phone:e.target.value}))} /></div>
        <div><label className={lbl}>Email</label><input type="email" className={inp} value={form.email} onChange={(e) => setForm(p=>({...p,email:e.target.value}))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={lbl}>Délai de paiement (jours)</label><input type="number" className={inp} value={form.paymentTermDays} onChange={(e) => setForm(p=>({...p,paymentTermDays:Number(e.target.value)}))} min={0} /></div>
        <div><label className={lbl}>Compte bancaire (RIB)</label><input className={inp} value={form.bankAccount} onChange={(e) => setForm(p=>({...p,bankAccount:e.target.value}))} /></div>
      </div>
      <div className="flex justify-end gap-3 pt-2 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-clay/30 rounded-lg text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-5 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"Enregistrement…":"Enregistrer"}</button>
      </div>
    </form>
  );
}
