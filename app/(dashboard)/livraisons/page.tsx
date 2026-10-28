"use client";
import { IfCan } from "@/components/shared/IfCan";
import { SearchBox } from "@/components/ui/SearchBox";
import { ClientFilterChip } from "@/components/shared/ClientFilterChip";
import { useUrlReady } from "@/lib/url-param";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";

import { buttonClass } from "@/components/ui/button-class";
import { useApi } from "@/lib/use-api";
// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};
interface Delivery {
  _id: string;
  number: string;
  invoiceId: { number: string } | null;
  clientId: { name: string } | null;
  deliveryDate: string;
  status: string;
  signedBy?: string;
}

export default function LivraisonsPage() {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");
  const ready = useUrlReady(p => setClientId(p.get("clientId") ?? ""));
  const LIMIT = 20;

  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  if (status) params.set("status", status);
  if (clientId) params.set("clientId", clientId);
  if (search) params.set("search", search);
  const { data: { items, total }, loading: reading } = useApi(ready ? `/api/livraisons?${params}` : null, d => ({
    items: (d.data?.items || []) as Delivery[],
    total: (d.data?.pagination?.total || 0) as number,
  }), { items: [] as Delivery[], total: 0 });
  // Tant que les filtres de l'adresse ne sont pas lus, la liste reste « en chargement ».
  const loading = !ready || reading;

  if (!mounted) return null;

  const columns: Column<Delivery>[] = [
    {
      key: "number",
      label: "N° BL",
      className: "font-mono text-section font-semibold text-sm",
      render: (v, r) => (
        <Link href={`/livraisons/${r._id}`} className="hover:underline">{String(v)}</Link>
      ),
    },
    {
      key: "invoiceId",
      label: "Facture liée",
      render: (v) => typeof v === "object" && v
        ? <span className="font-mono text-sm">{(v as { number: string }).number}</span>
        : <span className="text-ink2">—</span>,
    },
    {
      key: "clientId",
      label: "Client",
      render: (v) => typeof v === "object" && v ? (v as { name: string }).name : "—",
    },
    {
      key: "deliveryDate",
      label: "Date de livraison",
      render: (v) => new Date(String(v)).toLocaleDateString("fr-FR"),
    },
    {
      key: "signedBy",
      label: "Signé par",
      render: (v) => v ? String(v) : <span className="text-ink2">Non signé</span>,
    },
    {
      key: "status",
      label: "Statut",
      render: (v) => <StatusBadge status={String(v)} />,
    },
    {
      key: "_id",
      label: "Actions",
      render: (_v, row) => (
        <Link
          href={`/livraisons/${row._id}`}
          className={buttonClass("secondary", "sm")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
           Afficher
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Bons de livraison</h1>
          <p className="text-sm text-ink2 mt-0.5">{total} bon{total > 1 ? "s" : ""}</p>
        </div>
        <IfCan resource="livraisons">
        <Link href="/livraisons/new" className={buttonClass("primary", "md")}>
          + Nouveau BL
        </Link>
        </IfCan>
      </div>

      <div className="flex flex-wrap items-center gap-3">
      <SearchBox onSearch={q => { setSearch(q); setPage(1); }} placeholder="N°, article, client, facture…" className="w-full sm:w-64" />
      <select
        value={status}
        onChange={e => { setStatus(e.target.value); setPage(1); }}
        className="px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30"
      >
        <option value="">Tous les statuts</option>
        {["draft","issued","delivered","partially_delivered","returned"].map(s => (
          <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
        ))}
      </select>
      </div>

      {clientId && <ClientFilterChip name={((items[0]?.clientId as { name?: string } | undefined)?.name)} onClear={() => { setClientId(""); setPage(1); }} />}
      <DataTable
        columns={columns}
        data={items}
        loading={loading}
        keyExtractor={d => d._id}
        emptyMessage="Aucun bon de livraison"
      />

      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />
    </div>
  );
}