"use client";

import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { ClientForm } from "@/components/pme/ClientForm";

interface Client {
  _id: string;
  code: string;
  name: string;
  nif?: string;
  phone?: string;
  email?: string;
  currentBalance: number;
  creditLimit: number;
  paymentTermDays: number;
  isActive: boolean;
}

export default function ClientsPage() {
  const [mounted, setMounted] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (search) params.set("search", search);
    try {
      const res = await fetch(`/api/clients?${params}`, { credentials: "include" });
      const d = await res.json();
      setClients(d.data?.items || []);
      setTotal(d.data?.pagination?.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { setMounted(true); load(); }, [load]);

  // Debounce search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const columns: Column<Client>[] = [
    { key: "code", label: "Code", sortable: true, className: "font-mono text-xs w-24" },
    { key: "name", label: "Client", sortable: true },
    { key: "nif", label: "NIF", className: "text-moss text-xs" },
    { key: "phone", label: "Téléphone" },
    {
      key: "currentBalance",
      label: "Solde (XOF)",
      sortable: true,
      className: "text-right font-mono",
      render: (v) => {
        const n = Number(v);
        return (
          <span className={n < 0 ? "text-red-600" : n > 0 ? "text-green-700" : "text-moss"}>
            {n.toLocaleString("fr-FR")}
          </span>
        );
      },
    },
    {
      key: "paymentTermDays",
      label: "Délai paiement",
      render: (v) => <span className="text-moss">{v} j</span>,
    },
    {
      key: "isActive",
      label: "Statut",
      render: (v) => <StatusBadge status={v ? "active" : "inactive"} />,
    },
  ];

  if (!mounted) return null;

  async function handleSave(data: Partial<Client>) {
    const url = editing ? `/api/clients/${editing._id}` : "/api/clients";
    const method = editing ? "PATCH" : "POST";

    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();

    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include",
      body: JSON.stringify(data),
    });

    setModalOpen(false);
    setEditing(null);
    load();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Clients</h1>
          <p className="text-sm text-moss mt-0.5">{total} client{total > 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors"
        >
          + Nouveau client
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Rechercher par nom, code, NIF…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="w-full max-w-sm px-4 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30"
      />

      {/* Table */}
      <DataTable
        columns={columns}
        data={clients}
        loading={loading}
        keyExtractor={(c) => c._id}
        emptyMessage="Aucun client trouvé"
        onRowClick={(c) => { setEditing(c); setModalOpen(true); }}
      />

      <Pagination
        page={page}
        totalPages={Math.ceil(total / LIMIT)}
        total={total}
        limit={LIMIT}
        onPage={setPage}
      />

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        title={editing ? `Modifier — ${editing.name}` : "Nouveau client"}
        size="lg"
      >
        <ClientForm
          initial={editing || undefined}
          onSave={handleSave}
          onCancel={() => { setModalOpen(false); setEditing(null); }}
        />
      </Modal>
    </div>
  );
}
