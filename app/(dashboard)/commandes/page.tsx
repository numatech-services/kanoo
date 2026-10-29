"use client";
import { formatDate } from "@/lib/format";
import { IfCan } from "@/components/shared/IfCan";
import { SearchBox } from "@/components/ui/SearchBox";
import { useState, useSyncExternalStore } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { buttonClass } from "@/components/ui/button-class";
import { useApi } from "@/lib/use-api";
import Link from "next/link"; // Import indispensable

interface Commande { _id:string; number:string; supplierId:{name:string}|string; totalTTC:number; status:string; orderDate:string; expectedDeliveryDate?:string; }

const noSubscribe = () => () => {};

export default function CommandesPage() {
  // Rendu côté navigateur uniquement (dates au format local).
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [page, setPage] = useState(1); 
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(""); 
  const LIMIT = 20;

  const params = new URLSearchParams({page:String(page),limit:String(LIMIT)});
  if(status) params.set("status",status);
  if(search) params.set("search",search);
  const list = useApi<{ items?: Commande[]; pagination?: { total?: number } } | null>(`/api/commandes?${params}`, d => d.data ?? null, null);
  const commandes = list.data?.items||[];
  const total = list.data?.pagination?.total||0;
  const loading = list.loading;

  if(!mounted) return null;
const columns: Column<Commande>[] = [
    {
      key: "number",
      label: "N° BC",
      className: "font-mono font-semibold text-section",
      sortable: true,
      // On rend le numéro cliquable
      render: (v, record) => (
        <Link 
          href={`/commandes/${record._id}`} 
          className="hover:underline hover:text-ink transition-colors"
        >
          {String(v)}
        </Link>
      )
    },
    {
      key: "supplierId",
      label: "Fournisseur",
      render: (v) => typeof v === "object" && v ? (v as { name: string }).name : "—"
    },
    {
      key: "orderDate",
      label: "Date commande",
      render: (v) => formatDate(v)
    },
    {
      key: "expectedDeliveryDate",
      label: "Livraison prévue",
      render: (v) => formatDate(v)
    },
    {
      key: "totalTTC",
      label: "Total TTC (FCFA)",
      className: "text-right font-mono",
      render: (v) => Number(v).toLocaleString("fr-FR")
    },
    {
      key: "status",
      label: "Statut",
      render: (v) => <StatusBadge status={String(v)} />
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
            <h1 className="page-title">Bons de commande</h1>
            <p className="text-sm text-ink2 mt-0.5">{total} commande{total>1?"s":""}</p>
        </div>
        <IfCan resource="commandes">
          <Link href="/commandes/new"
            className={buttonClass("primary", "md", "relative")}>
            + Nouveau BC
          </Link>
        </IfCan>
      </div>

      <div className="flex flex-wrap items-center gap-3">
      <SearchBox onSearch={q=>{setSearch(q);setPage(1);}} placeholder="N°, article, fournisseur…" className="w-full sm:w-64" />
      <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="px-3 py-2 border border-line rounded-lg text-sm">
        <option value="">Tous les statuts</option>
        {["draft","confirmed","partially_received","received","cancelled","invoiced"].map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
      </select>
      </div>

      <DataTable columns={columns} data={commandes} loading={loading} keyExtractor={c=>c._id} emptyMessage="Aucun bon de commande"/>
      
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>
    </div>
  );
}