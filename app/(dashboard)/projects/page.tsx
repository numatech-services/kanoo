"use client";

import { useState, useEffect, useCallback } from "react";
// CORRECTION : Importe useRouter depuis next/navigation
import { useRouter } from "next/navigation"; 
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";

interface Project { 
  _id: string; 
  code: string; 
  name: string; 
  budget?: number; 
  startDate?: string; 
  endDate?: string; 
  status: string; 
}

export default function ProjectsPage() {
  const [mounted, setMounted] = useState(false);
  // CORRECTION : Initialise le hook useRouter à l'intérieur du composant
  const router = useRouter(); 

  const [items, setItems] = useState<Project[]>([]); 
  const [total, setTotal] = useState(0); 
  const [page, setPage] = useState(1); 
  const [loading, setLoading] = useState(true);
  
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects?page=${page}&limit=${LIMIT}`, { credentials: "include" });
      const d = await res.json();
      // On s'assure de bien récupérer les données selon le format de ton API
      setItems(d.data?.items || d.data || []);
      setTotal(d.data?.pagination?.total || d.pagination?.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    setMounted(true);
    load();
  }, [load]);

  if (!mounted) return null;

  const columns: Column<Project>[] = [
    { key: "code", label: "Code", className: "font-mono text-xs w-24" },
    { key: "name", label: "Nom du projet", sortable: true },
    { key: "budget", label: "Budget (XOF)", className: "text-right font-mono", render: (v) => v ? Number(v).toLocaleString("fr-FR") : "—" },
    { key: "startDate", label: "Début", render: (v) => v ? new Date(String(v)).toLocaleDateString("fr-FR") : "—" },
    { key: "endDate", label: "Fin", render: (v) => v ? new Date(String(v)).toLocaleDateString("fr-FR") : "—" },
    { key: "status", label: "Statut", render: (v) => <StatusBadge status={String(v)} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Projets</h1>
          <p className="text-sm text-moss">{total} projet{total > 1 ? "s" : ""}</p>
        </div>
        <button 
          className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink" 
          onClick={() => router.push("/projects/new")}
        >
          + Nouveau projet
        </button>
      </div>
      
      <DataTable 
        columns={columns} 
        data={items} 
        loading={loading} 
        keyExtractor={p => p._id} 
        emptyMessage="Aucun projet"
        onRowClick={(p) => router.push(`/projects/${p._id}`)} // Permet d'ouvrir le détail du projet
      />
      
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