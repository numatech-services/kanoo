"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
interface Tender { _id:string; reference:string; object:string; estimatedAmount:number; bidsDeadline?:string; procedure:string; status:string; }
export default function AppelsOffresPage() {
  const [mounted, setMounted] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{ setMounted(true); fetch("/api/portail/fournisseur",{credentials:"include"}).then(r=>r.json()).then(d=>setTenders(d.data?.openTenders||[])).finally(()=>setLoading(false)); },[]);
  
  if (!mounted) return null;
  
  return (
    <div className="space-y-5">
      <div><Link href="/portail/fournisseur" className="text-xs text-moss hover:text-ink">← Tableau de bord</Link><h1 className="text-2xl font-bold text-ink mt-1">Appels d'offres ouverts</h1></div>
      {loading ? [...Array(3)].map((_,i)=><div key={i} className="h-24 bg-white rounded-xl animate-pulse"/>) :
       tenders.length===0 ? <div className="bg-white rounded-xl border border-clay/20 p-12 text-center text-moss">Aucun appel d'offres en cours</div> :
       tenders.map(t=>(
        <div key={t._id} className="bg-white rounded-xl border border-clay/20 p-5">
          <div className="flex justify-between items-start">
            <div><p className="font-mono text-xs text-cedar mb-1">{t.reference}</p><p className="font-semibold text-ink">{t.object}</p></div>
            <div className="text-right"><p className="font-mono font-bold">{t.estimatedAmount?.toLocaleString("fr-FR")} XOF</p>{t.bidsDeadline&&<p className="text-xs text-moss">Clôture : {new Date(t.bidsDeadline).toLocaleDateString("fr-FR")}</p>}</div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="px-4 py-2 bg-cedar text-white text-sm rounded-lg hover:bg-ink">📄 Télécharger le DAO</button>
            <button className="px-4 py-2 border border-clay/30 text-moss text-sm rounded-lg hover:bg-sand">✉️ Déposer une offre</button>
          </div>
        </div>
      ))}
    </div>
  );
}
