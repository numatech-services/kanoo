"use client";
import { ClientFilterChip } from "@/components/shared/ClientFilterChip";
import { useUrlReady } from "@/lib/url-param";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useMe, meCan, meCanDo } from "@/lib/useMe";
import { ToMarketDialog } from "@/components/devis/ToMarketDialog";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken } from "@/lib/api-client";
interface Devis { _id:string; number:string; clientId:{name:string}|null|string; totalHT:number; totalTTC:number; status:string; issueDate:string; validUntil:string; convertedToInvoiceId?:string; contractId?:string; }

export default function DevisPage() {
  const [devis,setDevis]=useState<Devis[]>([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(1); const [loading,setLoading]=useState(true);
  const [status,setStatus]=useState(""); const LIMIT=20;
  const [clientId,setClientId]=useState("");
  const ready=useUrlReady(p=>setClientId(p.get("clientId")??""));
  const [convertDialog,setConvertDialog]=useState<{id:string;number:string;type:"invoice"|"proforma"}|null>(null);
  const [converting,setConverting]=useState(false);
  const me = useMe();
  const canInvoice = meCan(me.resources, "invoices");
  const canMarket = meCanDo(me, "contracts", "create");
  const [market,setMarket]=useState<Devis|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);
    const params=new URLSearchParams({page:String(page),limit:String(LIMIT)});
    if(status) params.set("status",status);
    if(clientId) params.set("clientId",clientId);
    if(!ready) return;
    const res=await fetch(`/api/devis?${params}`,{credentials:"include"});
    const d=await res.json(); setDevis(d.data?.items||[]); setTotal(d.data?.pagination?.total||0); setLoading(false);
  },[page,status,clientId,ready]);
  useEffect(()=>{load();},[load]);

  async function handleConvert() {
    if(!convertDialog) return;
    // Proforma : le PDF du devis titré « Facture proforma », rien n'est créé.
    if(convertDialog.type==="proforma"){ window.open(`/api/devis/${convertDialog.id}/pdf?proforma=1`,"_blank","noopener"); setConvertDialog(null); return; }
    setConverting(true);
    const csrfToken = await getCsrfToken();
    const res=await fetch(`/api/devis/${convertDialog.id}/to-invoice`,{method:"POST",headers:{"Content-Type":"application/json","x-csrf-token":csrfToken},credentials:"include",body:JSON.stringify({type:convertDialog.type})});
    const d=await res.json();
    if(res.ok){ showToast(d.data?.message ?? "Opération effectuée.", "success"); setConvertDialog(null); load(); }
    else showToast(d.error ?? "Opération impossible.", "error");
    setConverting(false);
  }

  const columns: Column<Devis>[] = [
    {key:"number",label:"N° Devis",className:"font-mono font-semibold text-section",render:(v,r)=><Link href={`/devis/${r._id}`} className="hover:underline">{String(v)}</Link>},
    {key:"clientId",label:"Client",render:(v)=>typeof v==="object"&&v?(v as {name:string}).name:"—"},
    {key:"issueDate",label:"Date",render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR")},
    {key:"validUntil",label:"Validité",render:(v)=>{const d=new Date(String(v));const expired=d<new Date();return<span className={expired?"text-neg text-sm":"text-ink2 text-sm"}>{d.toLocaleDateString("fr-FR")}</span>;}},
    {key:"totalHT",label:"HT (FCFA)",className:"text-right font-mono",render:(v)=>Number(v).toLocaleString("fr-FR")},
    {key:"totalTTC",label:"TTC (FCFA)",className:"text-right font-mono font-semibold",render:(v)=>Number(v).toLocaleString("fr-FR")},
    {key:"status",label:"Statut",render:(v)=><StatusBadge status={String(v)}/>},
    {key:"_id",label:"Actions",render:(v,row)=>row.contractId
      ? <Link href={`/contracts/${row.contractId}`} className="text-xs text-section font-semibold hover:underline">Marché →</Link>
      : row.convertedToInvoiceId
      ? <span className="text-xs text-ink2 bg-surface2 px-2 py-0.5 rounded">Converti ✓</span>
      : !canInvoice
      // Les services préparent le devis ; la comptabilité le transforme en facture.
      ? <span className="text-xs text-ink3">Facturation : comptabilité</span>
      : (
        <div className="flex gap-1">
          {canMarket && !["rejected","expired"].includes(row.status) && <button onClick={e=>{e.stopPropagation();setMarket(row);}} className="px-2 py-1 bg-section text-white text-xs rounded hover:brightness-95" title="Suivre acomptes, dépenses et marge">→ Marché</button>}
          <button onClick={e=>{e.stopPropagation();setConvertDialog({id:String(v),number:row.number,type:"invoice"});}} className="px-2 py-1 bg-pos text-white text-xs rounded hover:brightness-95">→ Facture</button>
          <button onClick={e=>{e.stopPropagation();setConvertDialog({id:String(v),number:row.number,type:"proforma"});}} className="px-2 py-1 bg-warn text-white text-xs rounded hover:brightness-95">→ Proforma</button>
        </div>
      )
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Devis</h1><p className="text-sm text-ink2">{total} devis</p></div>
        <Link href="/devis/new" className={buttonClass("primary", "md")}>+ Nouveau devis</Link>
      </div>

      <div className="bg-warn-50 border border-warn/25 rounded-xl p-3 text-xs text-warn">
        <strong>Flux :</strong> Devis accepté → <strong>« → Marché »</strong> pour suivre acomptes, dépenses et marge (facturation depuis la fiche du marché), ou <strong>« → Facture »</strong> pour une facture unique. <strong>« → Proforma »</strong> ouvre le PDF du devis titré facture proforma, sans rien comptabiliser.
      </div>

      <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="px-3 py-2 border border-line rounded-lg text-sm">
        <option value="">Tous les statuts</option>
        {["draft","sent","accepted","rejected","expired"].map(s=><option key={s} value={s}>{s}</option>)}
      </select>

      {clientId&&<ClientFilterChip name={((devis[0]?.clientId as { name?: string } | undefined)?.name)} onClear={()=>{setClientId("");setPage(1);}}/>}
      <DataTable columns={columns} data={devis} loading={loading} keyExtractor={d=>d._id} emptyMessage="Aucun devis"/>
      <Pagination page={page} totalPages={Math.ceil(total/LIMIT)} total={total} limit={LIMIT} onPage={setPage}/>

      <ConfirmDialog
        open={!!convertDialog}
        title={convertDialog?.type==="proforma"?"Créer une facture proforma":"Convertir en facture définitive"}
        message={convertDialog?.type==="proforma"
          ? `Le PDF du devis ${convertDialog?.number} s'ouvrira titré « Facture proforma ». Rien n'est enregistré ni comptabilisé.`
          : `Le devis ${convertDialog?.number} sera converti en facture définitive. Une écriture comptable (journal Ventes) sera automatiquement générée.`
        }
        confirmLabel={convertDialog?.type==="proforma"?"Ouvrir la proforma":"Créer la facture"}
        busy={converting}
        busyLabel="Conversion…"
        onConfirm={handleConvert}
        onCancel={()=>setConvertDialog(null)}
      />
      {market && <ToMarketDialog devis={market} onClose={()=>setMarket(null)} />}
    </div>
  );
}
