"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { useApi } from "@/lib/use-api";
import { buttonClass } from "@/components/ui/button-class";
import { PageLoading } from "@/components/ui/PageState";
interface Don { _id:string; donorName?:string; donorType:string; amount:number; currency:string; campaign?:string; date:string; receiptNumber:string; }
// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};
export default function DonsPage() {
  const mounted=useSyncExternalStore(noSubscribe,()=>true,()=>false);
  const [page,setPage]=useState(1);
  const LIMIT=20;
  const {data:{items,total},loading}=useApi<{items:Don[];total:number}>(`/api/dons?page=${page}&limit=${LIMIT}`,d=>({items:d.data?.items||[],total:d.data?.pagination?.total||0}),{items:[],total:0});
  if (!mounted) return <PageLoading />;
  const totalXOF=items.filter(d=>d.currency==="XOF").reduce((s,d)=>s+d.amount,0);
  const columns: Column<Don>[] = [
    {key:"donorName",label:"Donateur",render:(v,r)=>v?String(v):<span className="text-ink2 italic">Anonyme ({r.donorType})</span>},
    {key:"amount",label:"Montant",className:"text-right font-mono font-bold",render:(v,r)=>`${Number(v).toLocaleString("fr-FR")} ${r.currency}`},
    {key:"campaign",label:"Campagne",render:(v)=>v ? String(v) : <span className="text-ink2">—</span>},
    {key:"date",label:"Date",render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR")},
    {key:"receiptNumber",label:"N° reçu",className:"font-mono text-xs text-section"},
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Dons</h1><p className="text-sm text-ink2">{total} don{total>1?"s":" reçu"} · Total FCFA : {totalXOF.toLocaleString("fr-FR")}</p></div>
        <Link href="/associations/dons/new" className={buttonClass("primary", "md")}>+ Enregistrer un don</Link>
      </div>
      <DataTable columns={columns} data={items} loading={loading} keyExtractor={d=>d._id} emptyMessage="Aucun don enregistré"/>
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>
    </div>
  );
}
