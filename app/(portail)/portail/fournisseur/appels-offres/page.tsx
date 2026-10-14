"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button-class";
import { apiJson } from "@/lib/api-client";
interface Tender { _id:string; reference:string; object:string; estimatedAmount:number; bidsDeadline?:string; procedure:string; status:string; }
export default function AppelsOffresPage() {
  const [mounted, setMounted] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{ setMounted(true); apiJson("/api/portail/fournisseur").then(d=>setTenders(d.data?.openTenders||[])).finally(()=>setLoading(false)); },[]);
  
  if (!mounted) return null;
  
  return (
    <div className="space-y-5">
      <div><Link href="/portail/fournisseur" className="text-xs text-ink2 hover:text-ink">← Tableau de bord</Link><h1 className="page-title mt-1">Appels d'offres ouverts</h1></div>
      {loading ? [...Array(3)].map((_,i)=><div key={i} className="h-24 bg-surface rounded-xl animate-pulse"/>) :
       tenders.length===0 ? <div className="bg-surface rounded-xl border border-line p-12 text-center text-ink2">Aucun appel d'offres en cours</div> :
       tenders.map(t=>(
        <div key={t._id} className="bg-surface rounded-xl border border-line p-5">
          <div className="flex justify-between items-start">
            <div><p className="font-mono text-xs text-section mb-1">{t.reference}</p><p className="font-semibold text-ink">{t.object}</p></div>
            <div className="text-right"><p className="font-mono font-bold">{t.estimatedAmount?.toLocaleString("fr-FR")} FCFA</p>{t.bidsDeadline&&<p className="text-xs text-ink2">Clôture : {new Date(t.bidsDeadline).toLocaleDateString("fr-FR")}</p>}</div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className={buttonClass("primary", "md")}>Télécharger le DAO</button>
            <button className={buttonClass("secondary", "md")}>Déposer une offre</button>
          </div>
        </div>
      ))}
    </div>
  );
}
