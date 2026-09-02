"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
interface Don { _id:string; donorName?:string; donorType:string; amount:number; currency:string; campaign?:string; date:string; receiptNumber:string; }
export default function DonsPage() {
  const [mounted,setMounted]=useState(false);
  const [items,setItems]=useState<Don[]>([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(1); const [loading,setLoading]=useState(true);
  const LIMIT=20;
  const load=useCallback(async()=>{setLoading(true);const res=await fetch(`/api/dons?page=${page}&limit=${LIMIT}`,{credentials:"include"});const d=await res.json();setItems(d.data?.items||[]);setTotal(d.data?.pagination?.total||0);setLoading(false);},[page]);
  useEffect(()=>{setMounted(true);load();},[load]);
  if (!mounted) return null;
  const totalXOF=items.filter(d=>d.currency==="XOF").reduce((s,d)=>s+d.amount,0);
  const columns: Column<Don>[] = [
    {key:"donorName",label:"Donateur",render:(v,r)=>v?String(v):<span className="text-moss italic">Anonyme ({r.donorType})</span>},
    {key:"amount",label:"Montant",className:"text-right font-mono font-bold",render:(v,r)=>`${Number(v).toLocaleString("fr-FR")} ${r.currency}`},
    {key:"campaign",label:"Campagne",render:(v)=>v||<span className="text-moss">—</span>},
    {key:"date",label:"Date",render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR")},
    {key:"receiptNumber",label:"N° reçu",className:"font-mono text-xs text-cedar"},
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Dons</h1><p className="text-sm text-moss">{total} don{total>1?"s":" reçu"} · Total XOF : {totalXOF.toLocaleString("fr-FR")}</p></div>
        <button onClick={() => window.location.href = "/associations/dons/new"} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Enregistrer un don</button>
      </div>
      <DataTable columns={columns} data={items} loading={loading} keyExtractor={d=>d._id} emptyMessage="Aucun don enregistré"/>
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>
    </div>
  );
}
