"use client";
import { ClientFilterChip } from "@/components/shared/ClientFilterChip";
import { useUrlReady } from "@/lib/url-param";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { useMe, meCanDo } from "@/lib/useMe";

interface Contract { _id:string; reference:string; title:string; type:string; clientId:{name:string}|null; amount:number; paymentMode:string; isRecurring:boolean; billingFrequency:string; status:string; startDate?:string; endDate?:string; nextBillingDate?:string; invoiceIds:string[]; }

const PAYMENT_MODE_LABELS: Record<string,string> = {
  virement:"Virement bancaire", cheque:"Chèque", tresor_public:"Trésor public",
  tresor_prive:"Trésor privé", especes:"Espèces", mobile_money:"Mobile Money", autre:"Autre"
};

export default function ContractsPage() {
  // Marges : gérant et comptabilité (accès au journal).
  const canSeeMargins = meCanDo(useMe(), "accountingEntries", "read");
  const [mounted,setMounted]=useState(false);
  const [contracts,setContracts]=useState<Contract[]>([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(1); const [loading,setLoading]=useState(true);
  const [status,setStatus]=useState(""); const [type,setType]=useState(""); const [isRecurring,setIsRecurring]=useState(""); const LIMIT=20;
  const [clientId,setClientId]=useState("");
  const ready=useUrlReady(p=>setClientId(p.get("clientId")??""));

  const load=useCallback(async()=>{
    setLoading(true);
    const params=new URLSearchParams({page:String(page),limit:String(LIMIT)});
    if(status) params.set("status",status);
    if(type) params.set("type",type);
    if(isRecurring) params.set("isRecurring",isRecurring);
    if(clientId) params.set("clientId",clientId);
    if(!ready) return;
    const res=await fetch(`/api/contracts?${params}`,{credentials:"include"});
    const d=await res.json(); setContracts(d.data?.items||[]); setTotal(d.data?.pagination?.total||0); setLoading(false);
  },[page,status,type,isRecurring,clientId,ready]);
  useEffect(()=>{setMounted(true);load();;},[load]);

  if(!mounted) return null;

  const columns: Column<Contract>[] = [
    {key:"reference",label:"Réf.",className:"font-mono text-xs text-section",sortable:true},
    {key:"title",label:"Titre",render:(v,r)=><Link href={`/contracts/${r._id}`} className="text-ink hover:text-section hover:underline font-medium">{String(v)}</Link>},
    {key:"clientId",label:"Client",render:(v)=>typeof v==="object"&&v?(v as {name:string}).name:<span className="text-ink2">—</span>},
    {key:"amount",label:"Montant (XOF)",className:"text-right font-mono",render:(v)=>Number(v)>0?Number(v).toLocaleString("fr-FR"):"—"},
    {key:"paymentMode",label:"Mode paiement",render:(v)=><span className="text-xs text-ink2">{PAYMENT_MODE_LABELS[String(v)]||String(v)}</span>},
    {key:"isRecurring",label:"Type",render:(v,r)=>v?<span className="text-xs bg-section-soft text-section px-2 py-0.5 rounded-full">{r.billingFrequency}</span>:<span className="text-xs bg-surface2 text-ink2 px-2 py-0.5 rounded-full">Ponctuel</span>},
    {key:"invoiceIds",label:"Factures",render:(v)=>{const arr=v as string[];return arr.length>0?<span className="text-xs bg-info-50 text-info px-2 py-0.5 rounded-full">{arr.length} facture{arr.length>1?"s":""}</span>:<span className="text-xs text-ink2">0</span>;}},
    {key:"status",label:"Statut",render:(v)=><StatusBadge status={String(v)}/>},
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Contrats</h1><p className="text-sm text-ink2 mt-0.5">{total} contrat{total>1?"s":""}</p></div>
        <div className="flex gap-2">
          {canSeeMargins && <Link href="/contracts/rentabilite" className="px-4 py-2 border border-line2 rounded-lg text-sm font-medium hover:bg-surface2">Rentabilité des marchés</Link>}
          <Link href="/contracts/new" className="px-4 py-2 bg-section text-white rounded-lg text-sm font-medium hover:brightness-95">+ Nouveau contrat</Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <select value={type} onChange={e=>{setType(e.target.value);setPage(1);}} className="px-3 py-2 border border-line rounded-lg text-sm">
          <option value="">Tous les types</option>
          <option value="client">Client</option><option value="supplier">Fournisseur</option>
          <option value="employment">Emploi</option><option value="freelance">Freelance</option>
        </select>
        <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="px-3 py-2 border border-line rounded-lg text-sm">
          <option value="">Tous les statuts</option>
          {["draft","active","suspended","expired","cancelled"].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={isRecurring} onChange={e=>{setIsRecurring(e.target.value);setPage(1);}} className="px-3 py-2 border border-line rounded-lg text-sm">
          <option value="">Tous</option><option value="true">Récurrents</option><option value="false">Ponctuels</option>
        </select>
      </div>
      {clientId&&<ClientFilterChip name={((contracts[0]?.clientId as { name?: string } | undefined)?.name)} onClear={()=>{setClientId("");setPage(1);}}/>}
      <DataTable columns={columns} data={contracts} loading={loading} keyExtractor={c=>c._id} emptyMessage="Aucun contrat"/>
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>
    </div>
  );
}
