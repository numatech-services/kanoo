"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { ClientForm } from "@/components/pme/ClientForm";
import { useMe, meCan } from "@/lib/useMe";

import { csrfToken as getCsrfToken } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { buttonClass } from "@/components/ui/button-class";
import { PageLoading } from "@/components/ui/PageState";
interface Client {
  _id: string;
  code: string;
  name: string;
  nif?: string;
  phone?: string;
  email?: string;
  logo?: string;
  currentBalance: number;
  creditLimit: number;
  paymentTermDays: number;
  isActive: boolean;
}

const noSubscribe = () => () => {};

export default function ClientsPage() {
  const router = useRouter();
  // Rendu côté navigateur uniquement.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  // Le solde est une information financière : colonne masquée hors comptabilité.
  const { resources } = useMe();
  const seeBalance = meCan(resources, "invoices");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // « Nouveau client » depuis la recherche (⌘K) : /clients?new=1 ouvre le formulaire.
  // Lu à l'initialisation : l'écran ne s'affiche qu'une fois dans le navigateur.
  const [modalOpen, setModalOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1");
  const [editing, setEditing] = useState<Client | null>(null);

  const LIMIT = 20;

  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  if (search) params.set("search", search);
  const list = useApi<{ items?: Client[]; pagination?: { total?: number } } | null>(`/api/clients?${params}`, d => d.data ?? null, null);
  const clients = list.data?.items || [];
  const total = list.data?.pagination?.total || 0;
  const { loading, reload: load } = list;

  // Debounce search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const columns: Column<Client>[] = [
    { key: "code", label: "Code", sortable: true, className: "font-mono text-xs w-24" },
    {
      key: "name", label: "Client", sortable: true, mobile: "title",
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
    { key: "nif", label: "NIF", className: "text-ink2 text-xs" },
    { key: "phone", label: "Téléphone" },
    ...(!seeBalance ? [] : [{
      key: "currentBalance",
      label: "Solde (FCFA)",
      sortable: true,
      className: "text-right font-mono",
      render: (v) => {
        const n = Number(v);
        return (
          <span className={n < 0 ? "text-neg" : n > 0 ? "text-pos" : "text-ink2"}>
            {n.toLocaleString("fr-FR")}
          </span>
        );
      },
    } as Column<Client>]),
    {
      key: "paymentTermDays",
      label: "Délai paiement",
      render: (v) => <span className="text-ink2">{String(v ?? "—")} j</span>,
    },
    {
      key: "isActive",
      label: "Statut",
      render: (v) => <StatusBadge status={v ? "active" : "inactive"} />,
    },
  ];

  if (!mounted) return <PageLoading />;

  async function handleSave(data: Partial<Client>) {
    const url = editing ? `/api/clients/${editing._id}` : "/api/clients";
    const method = editing ? "PATCH" : "POST";

    const csrfToken = await getCsrfToken();

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
          <h1 className="page-title">Clients</h1>
          <p className="text-sm text-ink2 mt-0.5">{total} client{total > 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className={buttonClass("primary", "md")}
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
        className="w-full max-w-sm px-4 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30"
      />

      {/* Table */}
      <DataTable
        columns={columns}
        data={clients}
        loading={loading}
        keyExtractor={(c) => c._id}
        emptyMessage="Aucun client trouvé"
        onRowClick={(c) => router.push(`/clients/${c._id}`)}
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
