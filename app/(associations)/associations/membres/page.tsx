"use client";

import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";

interface Member {
  _id: string;
  code: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  membershipType: string;
  joinDate: string;
  status: string;
}

export default function MembresPage() {
  const [mounted, setMounted] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const LIMIT = 20;

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (search) params.set("search", search);
    try {
      const res = await fetch(`/api/membres?${params}`, { credentials: "include" });
      const d = await res.json();
      setMembers(d.data?.items || []);
      setTotal(d.data?.pagination?.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { setMounted(true); load(); }, [load]);

  const columns: Column<Member>[] = [
    { key: "code", label: "N°", className: "font-mono text-xs w-20", sortable: true },
    {
      key: "lastName",
      label: "Nom complet",
      sortable: true,
      render: (_v, row) => `${row.firstName} ${row.lastName}`,
    },
    { key: "membershipType", label: "Catégorie" },
    {
      key: "joinDate",
      label: "Adhésion",
      render: (v) => new Date(String(v)).toLocaleDateString("fr-FR"),
    },
    { key: "phone", label: "Téléphone" },
    { key: "email", label: "Email" },
    {
      key: "status",
      label: "Statut",
      render: (v) => <StatusBadge status={String(v)} />,
    },
  ];

  if (!mounted) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Adhérents</h1>
          <p className="text-sm text-moss mt-0.5">{total} adhérent{total > 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors"
        >
          + Nouvel adhérent
        </button>
      </div>

      <input
        type="text"
        placeholder="Rechercher par nom, code…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="w-full max-w-sm px-4 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30"
      />

      <DataTable
        columns={columns}
        data={members}
        loading={loading}
        keyExtractor={(m) => m._id}
        emptyMessage="Aucun adhérent enregistré"
        onRowClick={(m) => { setEditing(m); setModalOpen(true); }}
      />

      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        title={editing ? `Modifier — ${editing.firstName} ${editing.lastName}` : "Nouvel adhérent"}
        size="lg"
      >
        <MemberForm
          initial={editing || undefined}
          onSave={async (data) => {
            const url = editing ? `/api/membres/${editing._id}` : "/api/membres";
            const csrfRes = await fetch("/api/auth/csrf");
            const { csrfToken } = await csrfRes.json();
            await fetch(url, {
              method: editing ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
              credentials: "include",
              body: JSON.stringify(data),
            });
            setModalOpen(false);
            load();
          }}
          onCancel={() => { setModalOpen(false); setEditing(null); }}
        />
      </Modal>
    </div>
  );
}

function MemberForm({ initial, onSave, onCancel }: {
  initial?: Partial<Member>;
  onSave: (d: Partial<Member>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    code: initial?.code || "",
    firstName: initial?.firstName || "",
    lastName: initial?.lastName || "",
    email: initial?.email || "",
    phone: initial?.phone || "",
    membershipType: initial?.membershipType || "membre_actif",
    joinDate: initial?.joinDate ? initial.joinDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    status: initial?.status || "active",
  });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const lbl = "block text-xs font-medium text-moss mb-1";

  return (
    <form onSubmit={async (e) => { e.preventDefault(); setSaving(true); await onSave(form); setSaving(false); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><label className={lbl}>Code *</label><input className={inp} value={form.code} onChange={(e) => setForm(p => ({ ...p, code: e.target.value }))} required /></div>
        <div>
          <label className={lbl}>Catégorie</label>
          <select className={inp} value={form.membershipType} onChange={(e) => setForm(p => ({ ...p, membershipType: e.target.value }))}>
            <option value="membre_actif">Membre actif</option>
            <option value="membre_associe">Membre associé</option>
            <option value="membre_honoraire">Membre honoraire</option>
            <option value="bienfaiteur">Bienfaiteur</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={lbl}>Prénom *</label><input className={inp} value={form.firstName} onChange={(e) => setForm(p => ({ ...p, firstName: e.target.value }))} required /></div>
        <div><label className={lbl}>Nom *</label><input className={inp} value={form.lastName} onChange={(e) => setForm(p => ({ ...p, lastName: e.target.value }))} required /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={lbl}>Email</label><input type="email" className={inp} value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} /></div>
        <div><label className={lbl}>Téléphone</label><input className={inp} value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={lbl}>Date d'adhésion</label><input type="date" className={inp} value={form.joinDate} onChange={(e) => setForm(p => ({ ...p, joinDate: e.target.value }))} /></div>
        <div>
          <label className={lbl}>Statut</label>
          <select className={inp} value={form.status} onChange={(e) => setForm(p => ({ ...p, status: e.target.value }))}>
            <option value="active">Actif</option>
            <option value="inactive">Inactif</option>
            <option value="suspended">Suspendu</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-clay/30 rounded-lg text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-5 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink disabled:opacity-60">
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
