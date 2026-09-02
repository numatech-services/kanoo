"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
interface Cotisation { _id:string; memberId:{firstName:string;lastName:string}|string; year:number; amount:number; paidAt?:string; receiptNumber:string; }
export default function CotisationsPage() {
  const [mounted,setMounted]=useState(false);
  const [items,setItems]=useState<Cotisation[]>([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(1); const [loading,setLoading]=useState(true);
  const [year,setYear]=useState(new Date().getFullYear()); const LIMIT=30;
  const load=useCallback(async()=>{setLoading(true);const res=await fetch(`/api/cotisations?year=${year}&page=${page}&limit=${LIMIT}`,{credentials:"include"});const d=await res.json();setItems(d.data?.items||[]);setTotal(d.data?.pagination?.total||0);setLoading(false);},[page,year]);
  useEffect(()=>{setMounted(true);load();},[load]);
  if (!mounted) return null;
  const paid=items.filter(i=>i.paidAt).length;
  const columns: Column<Cotisation>[] = [
    {key:"memberId",label:"Adhérent",render:(v)=>typeof v==="object"&&v?`${(v as {firstName:string;lastName:string}).firstName} ${(v as {firstName:string;lastName:string}).lastName}`:"—"},
    {key:"year",label:"Année",className:"text-moss"},
    {key:"amount",label:"Montant (XOF)",className:"text-right font-mono",render:(v)=>Number(v).toLocaleString("fr-FR")},
    {key:"paidAt",label:"Date paiement",render:(v)=>v?new Date(String(v)).toLocaleDateString("fr-FR"):<span className="text-amber-600 font-medium">Non payée</span>},
    {key:"receiptNumber",label:"N° reçu",className:"font-mono text-xs text-cedar"},
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Cotisations</h1><p className="text-sm text-moss">{paid}/{total} payées pour {year}</p></div>
        <div className="flex gap-3">
          <select value={year} onChange={e=>{setYear(Number(e.target.value));setPage(1);}} className="px-3 py-2 border border-clay/30 rounded-lg text-sm">{[year-1,year,year+1].map(y=><option key={y} value={y}>{y}</option>)}</select>
          <button onClick={() => window.location.href = "/associations/cotisations/new"} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Enregistrer paiement</button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[{l:"Total",v:total,c:"text-ink"},{l:"Payées",v:paid,c:"text-green-700"},{l:"En attente",v:total-paid,c:"text-amber-700"}].map(k=>(
          <div key={k.l} className="bg-white rounded-xl border border-clay/20 p-4"><p className="text-xs text-moss">{k.l}</p><p className={`text-2xl font-bold mt-1 ${k.c}`}>{k.v}</p></div>
        ))}
      </div>
      <DataTable columns={columns} data={items} loading={loading} keyExtractor={c=>c._id} emptyMessage="Aucune cotisation pour cette année"/>
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>
    </div>
  );
}
