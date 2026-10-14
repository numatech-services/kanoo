"use client";
import { IfCan } from "@/components/shared/IfCan";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { buttonClass } from "@/components/ui/button-class";
import Link from "next/link"; // Import indispensable

interface Commande { _id:string; number:string; supplierId:{name:string}|string; totalTTC:number; status:string; orderDate:string; expectedDeliveryDate?:string; }

export default function CommandesPage() {
  const [mounted, setMounted] = useState(false);
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [total, setTotal] = useState(0); 
  const [page, setPage] = useState(1); 
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(""); 
  const LIMIT = 20;

  const load = useCallback(async()=>{
    setLoading(true);
    const params = new URLSearchParams({page:String(page),limit:String(LIMIT)});
    if(status) params.set("status",status);
    const res = await fetch(`/api/commandes?${params}`,{credentials:"include"});
    const d = await res.json(); 
    setCommandes(d.data?.items||[]); 
    setTotal(d.data?.pagination?.total||0); 
    setLoading(false);
  },[page,status]);

  useEffect(()=>{setMounted(true);load();},[load]);

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
      render: (v) => new Date(String(v)).toLocaleDateString("fr-FR")
    },
    {
      key: "expectedDeliveryDate",
      label: "Livraison prévue",
      render: (v) => v ? new Date(String(v)).toLocaleDateString("fr-FR") : "—"
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

      <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="px-3 py-2 border border-line rounded-lg text-sm">
        <option value="">Tous les statuts</option>
        {["draft","confirmed","partially_received","received","cancelled","invoiced"].map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
      </select>

      <DataTable columns={columns} data={commandes} loading={loading} keyExtractor={c=>c._id} emptyMessage="Aucun bon de commande"/>
      
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>
    </div>
  );
}