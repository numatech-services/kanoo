"use client";
import { IfCan } from "@/components/shared/IfCan";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { useRouter } from "next/navigation";
import { LIBELLES_PROCEDURES } from "@/lib/niger-fiscal";

import { apiJson } from "@/lib/api-client";
import { buttonClass } from "@/components/ui/button-class";
interface Tender { 
  _id: string; 
  reference: string; 
  object: string; 
  estimatedAmount: number; 
  procedure: string; 
  status: string; 
  createdAt: string; 
}

export default function MarchesPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // L'API utilise withAuth("publicTenders", "read")
      const d = await apiJson(`/api/marches?page=${page}&limit=${LIMIT}`);
      setTenders(d.data?.items || []);
      setTotal(d.data?.pagination?.total || 0);
    } catch (err) {
      console.error("Erreur chargement marchés:", err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    setMounted(true);
    load();
  }, [load]);

  if (!mounted) return null;

  const columns: Column<Tender>[] = [
    { 
      key: "reference", 
      label: "Référence", 
      className: "font-mono text-section font-bold",
      render: (v, r) => (
        <button onClick={() => router.push(`/marches/${r._id}`)} className="hover:underline">
          {String(v)}
        </button>
      )
    },
    { key: "object", label: "Objet", className: "max-w-md truncate" },
    { 
      key: "estimatedAmount", 
      label: "Montant (FCFA)", 
      className: "text-right font-mono", 
      render: (v) => Number(v).toLocaleString("fr-FR") 
    },
    { 
      key: "procedure", 
      label: "Procédure", 
      render: (v) => (
        <span className="text-[10px] text-ink2 uppercase font-medium">
          {(LIBELLES_PROCEDURES as Record<string, string | undefined>)[String(v)]?.split("(")[0] || String(v)}
        </span>
      ) 
    },
    { key: "status", label: "Statut", render: (v) => <StatusBadge status={String(v)} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Marchés fournisseurs</h1>
          <p className="text-sm text-ink2">Niger - Code des Marchés Publics</p>
        </div>
        <IfCan resource="publicTenders">
          <button
            onClick={() => router.push("/marches/new")}
            className={buttonClass("primary", "md")}
          >
            + Nouveau marché
          </button>
        </IfCan>
      </div>

      <div className="bg-surface rounded-2xl border border-line shadow-sm overflow-hidden">
        <DataTable 
          columns={columns} 
          data={tenders} 
          loading={loading} 
          keyExtractor={t => t._id} 
          emptyMessage="Aucun marché trouvé"
          onRowClick={(row) => router.push(`/marches/${row._id}`)}
        />
      </div>

      <Pagination 
        page={page} 
        totalPages={Math.ceil(total / LIMIT)} 
        total={total} 
        limit={LIMIT} 
        onPage={setPage} 
      />
    </div>
  );
}