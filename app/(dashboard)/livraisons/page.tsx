"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";

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
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<Delivery[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) params.set("status", status);
    const res = await fetch(`/api/livraisons?${params}`, { credentials: "include" });
    const d = await res.json();
    setItems(d.data?.items || []);
    setTotal(d.data?.pagination?.total || 0);
    setLoading(false);
  }, [page, status]);

  useEffect(() => { setMounted(true); load(); }, [load]);

  if (!mounted) return null;

  const columns: Column<Delivery>[] = [
    {
      key: "number",
      label: "N° BL",
      className: "font-mono text-cedar font-semibold text-sm",
      render: (v, r) => (
        <Link href={`/livraisons/${r._id}`} className="hover:underline">{String(v)}</Link>
      ),
    },
    {
      key: "invoiceId",
      label: "Facture liée",
      render: (v) => typeof v === "object" && v
        ? <span className="font-mono text-sm">{(v as { number: string }).number}</span>
        : <span className="text-moss">—</span>,
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
      render: (v) => v ? String(v) : <span className="text-moss">Non signé</span>,
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
          className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-clay/30 rounded-lg text-moss hover:bg-sand hover:text-ink transition-colors"
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
          <h1 className="text-2xl font-bold text-ink">Bons de livraison</h1>
          <p className="text-sm text-moss mt-0.5">{total} bon{total > 1 ? "s" : ""}</p>
        </div>
        <Link href="/livraisons/new" className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors">
          + Nouveau BL
        </Link>
      </div>

      <select
        value={status}
        onChange={e => { setStatus(e.target.value); setPage(1); }}
        className="px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30"
      >
        <option value="">Tous les statuts</option>
        {["draft","issued","delivered","partially_delivered","returned"].map(s => (
          <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
        ))}
      </select>

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