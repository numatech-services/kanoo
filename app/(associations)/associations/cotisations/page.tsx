"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { urlParam } from "@/lib/url-param";
import { useApi } from "@/lib/use-api";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { buttonClass } from "@/components/ui/button-class";
import { PageLoading } from "@/components/ui/PageState";
interface Cotisation { _id:string; memberId:{firstName:string;lastName:string}|string; year:number; amount:number; paidAt?:string; receiptNumber:string; }
// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};
export default function CotisationsPage() {
  const mounted=useSyncExternalStore(noSubscribe,()=>true,()=>false);
  const [page,setPage]=useState(1);
  const [year,setYear]=useState(new Date().getFullYear()); const LIMIT=30;
  // Filtre payées / impayées, repris de l'adresse (raccourci « Impayés » du tableau de bord).
  const [paidFilter,setPaidFilter]=useState<""|"true"|"false">(()=>{const v=urlParam("paid");return v==="true"||v==="false"?v:"";});
  const q=`/api/cotisations?year=${year}&page=${page}&limit=${LIMIT}${paidFilter?`&paid=${paidFilter}`:""}`;
  const list=useApi<{items:Cotisation[];total:number}>(q,d=>({items:d.data?.items||[],total:d.data?.pagination?.total||0}),{items:[],total:0},{quiet:true});
  // Compteurs sur toute l'année, pas sur la page affichée.
  const all=useApi<number>(`/api/cotisations?year=${year}&limit=1`,a=>a.data?.pagination?.total||0,0,{quiet:true});
  const paidRes=useApi<number>(`/api/cotisations?year=${year}&paid=true&limit=1`,p=>p.data?.pagination?.total||0,0,{quiet:true});
  const {items,total}=list.data; const counts={all:all.data,paid:paidRes.data};
  const loading=list.loading||all.loading||paidRes.loading;
  if (!mounted) return <PageLoading />;
  const paid=counts.paid;
  const columns: Column<Cotisation>[] = [
    {key:"memberId",label:"Adhérent",render:(v)=>typeof v==="object"&&v?`${(v as {firstName:string;lastName:string}).firstName} ${(v as {firstName:string;lastName:string}).lastName}`:"—"},
    {key:"year",label:"Année",className:"text-ink2"},
    {key:"amount",label:"Montant (FCFA)",className:"text-right font-mono",render:(v)=>Number(v).toLocaleString("fr-FR")},
    {key:"paidAt",label:"Date paiement",render:(v)=>v?new Date(String(v)).toLocaleDateString("fr-FR"):<span className="text-warn font-medium">Non payée</span>},
    {key:"receiptNumber",label:"N° reçu",className:"font-mono text-xs text-section"},
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Cotisations</h1><p className="text-sm text-ink2">{paid}/{counts.all} payées pour {year}</p></div>
        <div className="flex gap-3">
          <select value={year} onChange={e=>{setYear(Number(e.target.value));setPage(1);}} className="px-3 py-2 border border-line rounded-lg text-sm">{[year-1,year,year+1].map(y=><option key={y} value={y}>{y}</option>)}</select>
          <Link href="/associations/cotisations/new" className={buttonClass("primary", "md")}>+ Enregistrer paiement</Link>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[{l:"Toutes",v:counts.all,c:"text-ink",f:""},{l:"Payées",v:paid,c:"text-pos",f:"true"},{l:"Impayées",v:counts.all-paid,c:"text-warn",f:"false"}].map(k=>(
          <button key={k.l} type="button" onClick={()=>{setPaidFilter(k.f as ""|"true"|"false");setPage(1);}} aria-pressed={paidFilter===k.f}
            className={`text-left rounded-xl border p-4 ${paidFilter===k.f?"border-section bg-section-soft":"bg-surface border-line hover:bg-surface2"}`}><p className="text-xs text-ink2">{k.l}</p><p className={`text-2xl font-bold mt-1 ${k.c}`}>{k.v}</p></button>
        ))}
      </div>
      <DataTable columns={columns} data={items} loading={loading} keyExtractor={c=>c._id} emptyMessage="Aucune cotisation pour cette année"/>
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>
    </div>
  );
}
