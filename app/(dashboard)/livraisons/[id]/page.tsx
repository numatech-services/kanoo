"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface Delivery {
  _id:string; number:string; status:string; deliveryDate:string; deliveryAddress?:string;
  signedAt?:string; signedBy?:string; notes?:string;
  invoiceId:{number:string;totalTTC:number;issueDate:string}|null;
  clientId:{name:string;code:string;nif?:string;address?:string;phone?:string}|null;
  lines:Array<{description:string;quantity:number;unit:string;notes?:string}>;
}

export default function LivraisonDetailPage() {
  const { id } = useParams();
  const [mounted, setMounted] = useState(false);
  const [delivery,setDelivery]=useState<Delivery|null>(null);
  const [loading,setLoading]=useState(true);
  const [signing,setSigning]=useState(false);
  const [signerName,setSignerName]=useState("");
  const [showSignForm,setShowSignForm]=useState(false);

  async function load() {
    const res=await fetch(`/api/livraisons/${id}`,{credentials:"include"});
    const d=await res.json(); setDelivery(d.data); setLoading(false);
  }
  useEffect(()=>{setMounted(true);load();},[id]);

  async function handleSign(e: React.FormEvent) {
    e.preventDefault(); setSigning(true);
    const csrfRes=await fetch("/api/auth/csrf"); const {csrfToken}=await csrfRes.json();
    await fetch(`/api/livraisons/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json","x-csrf-token":csrfToken},credentials:"include",body:JSON.stringify({status:"delivered",signedBy:signerName,signedAt:new Date().toISOString()})});
    setShowSignForm(false); load(); setSigning(false);
  }

  if(loading) return <div className="p-6"><div className="h-48 bg-white rounded-xl animate-pulse border border-clay/20"/></div>;
  if(!delivery) return <div className="p-6 text-moss">Bon de livraison introuvable</div>;
  if (!mounted) return null;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between">
        <div><Link href="/livraisons" className="text-xs text-moss hover:text-ink">← Bons de livraison</Link><h1 className="text-2xl font-bold text-ink mt-1">{delivery.number}</h1></div>
        <div className="flex gap-2 mt-2">
          <button onClick={()=>window.print()} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">🖨️ Imprimer</button>
          {!delivery.signedAt && delivery.status!=="delivered" && <button onClick={()=>setShowSignForm(true)} className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700">✍️ Signer la livraison</button>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
        <div className="bg-cedar text-white p-5 flex justify-between">
          <div><p className="text-lg font-bold">BON DE LIVRAISON</p><p className="text-white/70 text-sm font-mono">{delivery.number}</p></div>
          <div className="text-right"><p className="text-sm">{new Date(delivery.deliveryDate).toLocaleDateString("fr-FR")}</p><StatusBadge status={delivery.status}/></div>
        </div>

        <div className="p-5 grid grid-cols-2 gap-6 border-b border-clay/10">
          <div>
            <p className="text-xs text-moss uppercase font-semibold mb-2">Destinataire</p>
            {delivery.clientId && <><p className="font-semibold">{delivery.clientId.name}</p>{delivery.clientId.address&&<p className="text-sm text-moss">{delivery.clientId.address}</p>}{delivery.clientId.phone&&<p className="text-sm text-moss">{delivery.clientId.phone}</p>}</>}
          </div>
          <div>
            <p className="text-xs text-moss uppercase font-semibold mb-2">Facture liée</p>
            {delivery.invoiceId && <><p className="font-mono text-cedar">{delivery.invoiceId.number}</p><p className="text-sm text-moss">{delivery.invoiceId.totalTTC.toLocaleString("fr-FR")} XOF</p></>}
            {delivery.deliveryAddress && <><p className="text-xs text-moss mt-2 font-semibold">Adresse de livraison</p><p className="text-sm text-moss">{delivery.deliveryAddress}</p></>}
          </div>
        </div>

        <table className="w-full text-sm p-5">
          <thead><tr className="bg-sand/50 border-b border-clay/20">{["Description","Volume","Unité","Observations"].map(h=><th key={h} className="px-4 py-2 text-left text-xs font-semibold text-moss uppercase">{h}</th>)}</tr></thead>
          <tbody>
            {delivery.lines.map((l,i)=>(
              <tr key={i} className="border-b border-clay/10">
                <td className="px-4 py-3">{l.description}</td>
                <td className="px-4 py-3 font-mono font-bold">{l.quantity}</td>
                <td className="px-4 py-3 text-moss">{l.unit}</td>
                <td className="px-4 py-3 text-moss text-xs">{l.notes||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="p-5 grid grid-cols-2 gap-8 border-t border-clay/10">
          <div><p className="text-xs text-moss font-semibold uppercase mb-2">Émis par</p><div className="h-16 border border-clay/20 rounded-xl"/></div>
          <div>
            <p className="text-xs text-moss font-semibold uppercase mb-2">Reçu par le client</p>
            {delivery.signedBy
              ? <div className="h-16 border border-green-200 bg-green-50 rounded-xl flex items-center justify-center"><p className="text-green-700 font-medium text-sm">✅ {delivery.signedBy} — {delivery.signedAt?new Date(delivery.signedAt).toLocaleDateString("fr-FR"):""}</p></div>
              : <div className="h-16 border border-clay/20 rounded-xl flex items-center justify-center text-xs text-moss">Non signé</div>
            }
          </div>
        </div>
      </div>

      {showSignForm && (
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <h2 className="font-semibold text-ink mb-4">Confirmer la livraison</h2>
          <form onSubmit={handleSign} className="flex gap-3">
            <input className="flex-1 px-3 py-2 border border-clay/30 rounded-lg text-sm" value={signerName} onChange={e=>setSignerName(e.target.value)} placeholder="Nom du réceptionnaire" required/>
            <button type="submit" disabled={signing||!signerName} className="px-5 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-60">{signing?"Signature…":"Confirmer la réception"}</button>
            <button type="button" onClick={()=>setShowSignForm(false)} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
          </form>
        </div>
      )}
    </div>
  );
}
