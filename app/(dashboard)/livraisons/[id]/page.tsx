"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useMe, meCanDo } from "@/lib/useMe";

import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import {apiJson, api, apiErrorMessage, apiSend } from "@/lib/api-client";
import { buttonClass } from "@/components/ui/button-class";
interface Delivery {
  _id:string; number:string; status:string; deliveryDate:string; deliveryAddress?:string;
  signedAt?:string; signedBy?:string; notes?:string;
  invoiceId:{number:string;totalTTC:number;issueDate:string}|null;
  clientId:{name:string;code:string;nif?:string;address?:string;phone?:string}|null;
  lines:Array<{description:string;quantity:number;unit:string;notes?:string}>;
}


export default function LivraisonDetailPage() {
  const { id } = useParams();
  const canCancelBl = meCanDo(useMe(), "livraisons", "delete");
  const [mounted, setMounted] = useState(false);
  const [delivery,setDelivery]=useState<Delivery|null>(null);
  const [loading,setLoading]=useState(true);
  const [signing,setSigning]=useState(false);
  const [signerName,setSignerName]=useState("");
  const [showSignForm,setShowSignForm]=useState(false);

  const load = useCallback(async () => {
    const d = await apiJson(`/api/livraisons/${id}`); setDelivery(d.data); setLoading(false);
  }, [id]);
  useEffect(() => { setMounted(true); load(); }, [load]);

  async function handleSign(e: React.FormEvent) {
    e.preventDefault(); setSigning(true);
    try {
      await api.patch(`/api/livraisons/${id}`, { status: "delivered", signedBy: signerName, signedAt: new Date().toISOString() });
      setShowSignForm(false); showToast("Livraison signée.", "success");
    } catch (err) { showToast(apiErrorMessage(err, "Signature impossible."), "error"); }
    finally { setSigning(false); }
    load();
  }

  if(loading) return <div className="p-6"><div className="h-48 bg-surface rounded-xl animate-pulse border border-line"/></div>;
  if(!delivery) return <div className="p-6 text-ink2">Bon de livraison introuvable</div>;
  if (!mounted) return null;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between">
        <div><Link href="/livraisons" className="text-xs text-ink2 hover:text-ink">← Bons de livraison</Link><h1 className="page-title mt-1">{delivery.number}</h1></div>
        <div className="flex gap-2 mt-2">
          <button onClick={()=>window.print()} className={buttonClass("secondary", "md")}>Imprimer</button>
          {canCancelBl && <button onClick={async()=>{
            if(!(await confirmDialog({ title: "Annuler ce bon de livraison ?", message: "Les articles sortis seront remis en stock.", danger: true }))) return;
            const res=await apiSend("DELETE", `/api/livraisons/${id}`);
            if(res.ok) window.location.href="/livraisons"; else { const d= res.data; showToast(d.error||"Annulation impossible", "error"); }
          }} className="px-4 py-2 border border-neg/25 rounded-xl text-sm text-neg hover:bg-neg-50">Annuler le BL</button>}
          {!delivery.signedAt && delivery.status!=="delivered" && <button onClick={()=>setShowSignForm(true)} className="px-4 py-2 bg-pos text-white rounded-xl text-sm font-medium hover:brightness-95">Signer la livraison</button>}
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="bg-section text-white p-5 flex justify-between">
          <div><p className="text-lg font-bold">BON DE LIVRAISON</p><p className="text-white/70 text-sm font-mono">{delivery.number}</p></div>
          <div className="text-right"><p className="text-sm">{new Date(delivery.deliveryDate).toLocaleDateString("fr-FR")}</p><StatusBadge status={delivery.status}/></div>
        </div>

        <div className="p-5 grid grid-cols-2 gap-6 border-b border-line">
          <div>
            <p className="text-xs text-ink2 uppercase font-semibold mb-2">Destinataire</p>
            {delivery.clientId && <><p className="font-semibold">{delivery.clientId.name}</p>{delivery.clientId.address&&<p className="text-sm text-ink2">{delivery.clientId.address}</p>}{delivery.clientId.phone&&<p className="text-sm text-ink2">{delivery.clientId.phone}</p>}</>}
          </div>
          <div>
            <p className="text-xs text-ink2 uppercase font-semibold mb-2">Facture liée</p>
            {delivery.invoiceId && <><p className="font-mono text-section">{delivery.invoiceId.number}</p><p className="text-sm text-ink2">{delivery.invoiceId.totalTTC.toLocaleString("fr-FR")} FCFA</p></>}
            {delivery.deliveryAddress && <><p className="text-xs text-ink2 mt-2 font-semibold">Adresse de livraison</p><p className="text-sm text-ink2">{delivery.deliveryAddress}</p></>}
          </div>
        </div>

        <div className="overflow-x-auto">
        <table className="table-dense">
          <thead><tr className="bg-surface2/50 border-b border-line">{["Description","Volume","Unité","Observations"].map(h=><th key={h} >{h}</th>)}</tr></thead>
          <tbody>
            {delivery.lines.map((l,i)=>(
              <tr key={i} className="border-b border-line">
                <td className="px-4 py-3">{l.description}</td>
                <td className="px-4 py-3 font-mono font-bold">{l.quantity}</td>
                <td className="px-4 py-3 text-ink2">{l.unit}</td>
                <td className="px-4 py-3 text-ink2 text-xs">{l.notes||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>

        <div className="p-5 grid grid-cols-2 gap-8 border-t border-line">
          <div><p className="text-xs text-ink2 font-semibold uppercase mb-2">Émis par</p><div className="h-16 border border-line rounded-xl"/></div>
          <div>
            <p className="text-xs text-ink2 font-semibold uppercase mb-2">Reçu par le client</p>
            {delivery.signedBy
              ? <div className="h-16 border border-pos/25 bg-pos-50 rounded-xl flex items-center justify-center"><p className="text-pos font-medium text-sm">{delivery.signedBy} — {delivery.signedAt?new Date(delivery.signedAt).toLocaleDateString("fr-FR"):""}</p></div>
              : <div className="h-16 border border-line rounded-xl flex items-center justify-center text-xs text-ink2">Non signé</div>
            }
          </div>
        </div>
      </div>

      {showSignForm && (
        <div className="bg-surface rounded-xl border border-line p-5">
          <h2 className="font-semibold text-ink mb-4">Confirmer la livraison</h2>
          <form onSubmit={handleSign} className="flex gap-3">
            <input className="flex-1 px-3 py-2 border border-line rounded-lg text-sm" value={signerName} onChange={e=>setSignerName(e.target.value)} placeholder="Nom du réceptionnaire" required/>
            <button type="submit" disabled={signing||!signerName} className="px-5 py-2 bg-pos text-white rounded-xl text-sm font-medium hover:brightness-95 disabled:opacity-60">{signing?"Signature…":"Confirmer la réception"}</button>
            <button type="button" onClick={()=>setShowSignForm(false)} className={buttonClass("secondary", "md")}>Annuler</button>
          </form>
        </div>
      )}
    </div>
  );
}
