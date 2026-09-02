"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import Link from "next/link";

interface Tenant { _id: string; name: string; type: string; plan: string; subscriptionStatus: string; email?: string; userCount: number; createdAt: string; }

export default function TenantsPage() {
  const [mounted, setMounted] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(""); const [search, setSearch] = useState("");
  const [type, setType] = useState(""); const [status, setStatus] = useState("");
  const [createModal, setCreateModal] = useState(false);
  const [form, setForm] = useState({ name:"", type:"pme", email:"", adminEmail:"", adminPassword:"", adminFirstName:"", adminLastName:"", plan:"starter" });
  const [saving, setSaving] = useState(false); const LIMIT = 20;

  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400); return () => clearTimeout(t); }, [searchInput]);
  const load = useCallback(async () => {
    setMounted(true);
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (search) params.set("search", search);
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    const res = await fetch(`/api/superadmin/tenants?${params}`, { credentials: "include" });
    const d = await res.json(); setTenants(d.data?.items || []); setTotal(d.data?.pagination?.total || 0); setLoading(false);
  }, [page, search, type, status]);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/superadmin/tenants", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include", body: JSON.stringify(form) });
    const d = await res.json();
    if (res.ok) { setCreateModal(false); load(); alert(`Organisation créée. Token : ${d.data?.activationToken}`); }
    else alert(d.error);
    setSaving(false);
  }

  const columns: Column<Tenant>[] = [
{ 
    key: "name", 
    label: "Organisation", 
    sortable: true,
    // On transforme le nom en lien cliquable
    render: (v, item) => (
      <Link 
        href={`/saas/tenants/${item._id}`} 
        className="font-medium text-cedar hover:underline"
      >
        {String(v)}
      </Link>
    )
  },    { key: "type", label: "Profil", render: (v) => <span className="text-xs capitalize bg-clay/20 px-2 py-0.5 rounded">{String(v)}</span> },
    { key: "plan", label: "Plan", className: "text-xs text-moss" },
    { key: "subscriptionStatus", label: "Statut", render: (v) => <StatusBadge status={String(v)} /> },
    { key: "email", label: "Email" },
    { key: "userCount", label: "Utilisateurs", className: "text-center" },
    { key: "createdAt", label: "Création", render: (v) => new Date(String(v)).toLocaleDateString("fr-FR") },
  ];

  const inp = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const lbl = "block text-xs font-medium text-moss mb-1";

  if (!mounted) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Organisations</h1><p className="text-sm text-moss mt-0.5">{total} tenant{total > 1 ? "s" : ""}</p></div>
        <button onClick={() => setCreateModal(true)} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors">+ Créer une organisation</button>
      </div>
      <div className="flex flex-wrap gap-3">
        <input placeholder="Rechercher…" value={searchInput} onChange={e=>setSearchInput(e.target.value)} className="px-3 py-2 border border-clay/30 rounded-lg text-sm w-48" />
        <select value={type} onChange={e=>{setType(e.target.value);setPage(1);}} className="px-3 py-2 border border-clay/30 rounded-lg text-sm"><option value="">Tous les profils</option><option value="pme">PME</option><option value="association">Association</option><option value="administration">Administration</option></select>
        <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="px-3 py-2 border border-clay/30 rounded-lg text-sm"><option value="">Tous les statuts</option><option value="trial">Essai</option><option value="active">Actif</option><option value="suspended">Suspendu</option><option value="cancelled">Annulé</option></select>
      </div>
      <DataTable columns={columns} data={tenants} loading={loading} keyExtractor={(t) => t._id} emptyMessage="Aucune organisation" />
      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="Créer une organisation" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className={lbl}>Nom *</label><input className={inp} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required /></div>
            <div><label className={lbl}>Profil *</label><select className={inp} value={form.type} onChange={e=>setForm(p=>({...p,type:e.target.value}))}><option value="pme">PME</option><option value="association">Association</option><option value="administration">Administration</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={lbl}>Email organisation</label><input type="email" className={inp} value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} /></div>
            <div><label className={lbl}>Plan</label><select className={inp} value={form.plan} onChange={e=>setForm(p=>({...p,plan:e.target.value}))}><option value="starter">Starter</option><option value="pro">Pro</option><option value="asso_basic">Asso Basic</option><option value="asso_pro">Asso Pro</option><option value="admin">Admin</option></select></div>
          </div>
          <p className="text-xs font-semibold text-moss uppercase tracking-wide pt-2 border-t border-clay/20">Compte administrateur</p>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={lbl}>Prénom admin *</label><input className={inp} value={form.adminFirstName} onChange={e=>setForm(p=>({...p,adminFirstName:e.target.value}))} required /></div>
            <div><label className={lbl}>Nom admin *</label><input className={inp} value={form.adminLastName} onChange={e=>setForm(p=>({...p,adminLastName:e.target.value}))} required /></div>
          </div>
          <div><label className={lbl}>Email admin *</label><input type="email" className={inp} value={form.adminEmail} onChange={e=>setForm(p=>({...p,adminEmail:e.target.value}))} required /></div>
          <div><label className={lbl}>Mot de passe admin *</label><input type="password" className={inp} value={form.adminPassword} onChange={e=>setForm(p=>({...p,adminPassword:e.target.value}))} required /></div>
          <div className="flex justify-end gap-3 pt-2 border-t border-clay/20">
            <button type="button" onClick={() => setCreateModal(false)} className="px-4 py-2 text-sm border border-clay/30 rounded-lg text-moss hover:bg-sand">Annuler</button>
            <button type="submit" disabled={saving} className="px-5 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"Création…":"Créer"}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
