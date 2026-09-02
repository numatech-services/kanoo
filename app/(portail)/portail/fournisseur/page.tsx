"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

interface TenderData {
  _id:string; reference:string; object:string; estimatedAmount:number; bidsDeadline?:string; status:string; procedure:string;
}
interface FournisseurData {
  supplier: { name:string; code:string; nif?:string; isActive:boolean; };
  openTenders: TenderData[];
  contracts: Array<{ _id:string; reference:string; title:string; status:string; amount:number; startDate?:string; endDate?:string; }>;
}

const PROCEDURE_LABELS: Record<string,string> = { direct_purchase:"Achat direct",restricted_consultation:"Consultation restreinte",open_tender:"Appel d'offres ouvert",mutual_agreement:"Gré à gré" };

export default function PortailFournisseurPage() {
  const [data, setData] = useState<FournisseurData|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/portail/fournisseur", { credentials:"include" })
      .then(r=>r.json()).then(d=>{ if(d.success) setData(d.data); else setError(d.error||"Session expirée"); })
      .catch(()=>setError("Connexion impossible")).finally(()=>setLoading(false));
  }, []);

  if (loading) return <div className="space-y-4">{[1,2,3].map(i=><div key={i} className="h-24 bg-white rounded-xl animate-pulse border border-clay/20"/>)}</div>;

  if (error) return (
    <div className="text-center py-20">
      <p className="text-3xl mb-4">🏭</p>
      <h1 className="text-xl font-bold text-ink mb-2">Espace fournisseur</h1>
      <p className="text-moss mb-6">{error}</p>
      <Link href="/portail/fournisseur/connexion" className="px-6 py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink">Se connecter</Link>
    </div>
  );

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="bg-cedar text-white rounded-2xl p-6">
        <p className="text-white/60 text-sm">Espace fournisseur</p>
        <h1 className="text-2xl font-bold mt-1">{data.supplier.name}</h1>
        <p className="text-white/70 text-sm">{data.supplier.code}{data.supplier.nif&&` · NIF ${data.supplier.nif}`}</p>
        <div className="flex gap-3 mt-4">
          <Link href="/portail/fournisseur/appels-offres" className="px-4 py-2 bg-white/15 rounded-lg text-sm hover:bg-white/25">Appels d'offres</Link>
          <Link href="/portail/fournisseur/mes-offres" className="px-4 py-2 bg-white/15 rounded-lg text-sm hover:bg-white/25">Mes offres</Link>
        </div>
      </div>

      {/* Appels d'offres ouverts */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold text-ink">Appels d'offres ouverts ({data.openTenders.length})</h2>
          <Link href="/portail/fournisseur/appels-offres" className="text-xs text-cedar hover:underline">Voir tout →</Link>
        </div>
        {data.openTenders.length === 0
          ? <div className="bg-white rounded-xl border border-clay/20 p-8 text-center text-moss text-sm">Aucun appel d'offres en cours</div>
          : data.openTenders.map(t => (
            <div key={t._id} className="bg-white rounded-xl border border-clay/20 p-4 mb-3">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs text-cedar">{t.reference}</p>
                  <p className="font-medium text-ink text-sm mt-1 line-clamp-2">{t.object}</p>
                  <p className="text-xs text-moss mt-1">{PROCEDURE_LABELS[t.procedure]||t.procedure}</p>
                </div>
                <div className="text-right ml-4 flex-shrink-0">
                  <p className="font-mono font-bold text-sm">{t.estimatedAmount?.toLocaleString("fr-FR")} XOF</p>
                  {t.bidsDeadline && <p className="text-xs text-moss mt-0.5">Clôture : {new Date(t.bidsDeadline).toLocaleDateString("fr-FR")}</p>}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="px-4 py-1.5 bg-cedar text-white text-xs rounded-lg hover:bg-ink">Télécharger le DAO</button>
                <button className="px-4 py-1.5 border border-clay/30 text-moss text-xs rounded-lg hover:bg-sand">Déposer une offre</button>
              </div>
            </div>
          ))
        }
      </div>

      {/* Contrats */}
      {data.contracts.length > 0 && (
        <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
          <h2 className="font-semibold text-ink px-5 py-4 border-b border-clay/10">Mes contrats</h2>
          {data.contracts.map(c => (
            <div key={c._id} className="flex items-center justify-between px-5 py-3 border-b border-clay/10 last:border-0">
              <div><p className="font-mono text-xs text-cedar">{c.reference}</p><p className="text-sm font-medium text-ink">{c.title}</p></div>
              <div className="text-right"><p className="font-mono text-sm">{c.amount?.toLocaleString("fr-FR")} XOF</p><span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{c.status}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
