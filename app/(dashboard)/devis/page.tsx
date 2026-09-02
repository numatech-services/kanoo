"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

interface Devis { _id:string; number:string; clientId:{name:string}|null|string; totalHT:number; totalTTC:number; status:string; issueDate:string; validUntil:string; convertedToInvoiceId?:string; }

export default function DevisPage() {
  const [devis,setDevis]=useState<Devis[]>([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(1); const [loading,setLoading]=useState(true);
  const [status,setStatus]=useState(""); const LIMIT=20;
  const [convertDialog,setConvertDialog]=useState<{id:string;number:string;type:"invoice"|"proforma"}|null>(null);
  const [converting,setConverting]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);
    const params=new URLSearchParams({page:String(page),limit:String(LIMIT)});
    if(status) params.set("status",status);
    const res=await fetch(`/api/devis?${params}`,{credentials:"include"});
    const d=await res.json(); setDevis(d.data?.items||[]); setTotal(d.data?.pagination?.total||0); setLoading(false);
  },[page,status]);
  useEffect(()=>{load();},[load]);

  async function handleConvert() {
    if(!convertDialog) return;
    setConverting(true);
    const csrfRes=await fetch("/api/auth/csrf"); const {csrfToken}=await csrfRes.json();
    const res=await fetch(`/api/devis/${convertDialog.id}/to-invoice`,{method:"POST",headers:{"Content-Type":"application/json","x-csrf-token":csrfToken},credentials:"include",body:JSON.stringify({type:convertDialog.type})});
    const d=await res.json();
    if(res.ok){ alert(`✅ ${d.data?.message}`); setConvertDialog(null); load(); }
    else alert(`❌ ${d.error}`);
    setConverting(false);
  }

  const columns: Column<Devis>[] = [
    {key:"number",label:"N° Devis",className:"font-mono font-semibold text-cedar",render:(v,r)=><Link href={`/devis/${r._id}`} className="hover:underline">{String(v)}</Link>},
    {key:"clientId",label:"Client",render:(v)=>typeof v==="object"&&v?(v as {name:string}).name:"—"},
    {key:"issueDate",label:"Date",render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR")},
    {key:"validUntil",label:"Validité",render:(v)=>{const d=new Date(String(v));const expired=d<new Date();return<span className={expired?"text-red-500 text-sm":"text-moss text-sm"}>{d.toLocaleDateString("fr-FR")}</span>;}},
    {key:"totalHT",label:"HT (XOF)",className:"text-right font-mono",render:(v)=>Number(v).toLocaleString("fr-FR")},
    {key:"totalTTC",label:"TTC (XOF)",className:"text-right font-mono font-semibold",render:(v)=>Number(v).toLocaleString("fr-FR")},
    {key:"status",label:"Statut",render:(v)=><StatusBadge status={String(v)}/>},
    {key:"_id",label:"Actions",render:(v,row)=>row.convertedToInvoiceId
      ? <span className="text-xs text-moss bg-sand px-2 py-0.5 rounded">Converti ✓</span>
      : (
        <div className="flex gap-1">
          <button onClick={e=>{e.stopPropagation();setConvertDialog({id:String(v),number:row.number,type:"invoice"});}} className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">→ Facture</button>
          <button onClick={e=>{e.stopPropagation();setConvertDialog({id:String(v),number:row.number,type:"proforma"});}} className="px-2 py-1 bg-amber-500 text-white text-xs rounded hover:bg-amber-600">→ Proforma</button>
        </div>
      )
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Devis</h1><p className="text-sm text-moss">{total} devis</p></div>
        <Link href="/devis/new" className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Nouveau devis</Link>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
        <strong>Flux :</strong> Devis → accepté par client → bouton <strong>"→ Facture"</strong> (facture définitive avec écriture comptable) ou <strong>"→ Proforma"</strong> (facture pro forma sans comptabilisation).
      </div>

      <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="px-3 py-2 border border-clay/30 rounded-lg text-sm">
        <option value="">Tous les statuts</option>
        {["draft","sent","accepted","rejected","expired"].map(s=><option key={s} value={s}>{s}</option>)}
      </select>

      <DataTable columns={columns} data={devis} loading={loading} keyExtractor={d=>d._id} emptyMessage="Aucun devis"/>
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>

      <ConfirmDialog
        open={!!convertDialog}
        title={convertDialog?.type==="proforma"?"Créer une facture proforma":"Convertir en facture définitive"}
        message={convertDialog?.type==="proforma"
          ? `Le devis ${convertDialog?.number} sera converti en facture proforma. Aucune écriture comptable ne sera générée.`
          : `Le devis ${convertDialog?.number} sera converti en facture définitive. Une écriture comptable (journal Ventes) sera automatiquement générée.`
        }
        confirmLabel={convertDialog?.type==="proforma"?"Créer la proforma":"Créer la facture"}
        onConfirm={handleConvert}
        onCancel={()=>setConvertDialog(null)}
      />
    </div>
  );
}
