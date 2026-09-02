"use client";
import { useState, useEffect } from "react";
export default function TVAPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()+1);
  const [data, setData] = useState<{tvaCollectee:number;tvaDeductible:number;tvaNette:number;aVerser:number;creditReporte:number;statut:string}|null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(()=>{
    setLoading(true);
    fetch(`/api/fiscal/tva?annee=${year}&mois=${month}`,{credentials:"include"}).then(r=>r.json()).then(d=>setData(d.data)).finally(()=>setLoading(false));
  },[year,month]);
  const inp = "px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const MONTHS = ["","Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 text-sm text-moss mb-2"><a href="/fiscalite" className="hover:text-ink">Fiscalité</a><span>→</span><span className="text-ink font-medium">TVA</span></div>
        <h1 className="text-2xl font-bold text-ink">Déclaration TVA</h1>
      </div>
      <div className="flex gap-3">
        <select value={month} onChange={e=>setMonth(Number(e.target.value))} className={inp}>{MONTHS.slice(1).map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select>
        <select value={year} onChange={e=>setYear(Number(e.target.value))} className={inp}>{[year-1,year,year+1].map(y=><option key={y} value={y}>{y}</option>)}</select>
      </div>
      {loading ? <div className="h-48 bg-sand animate-pulse rounded-xl"/> : data && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-clay/20 p-5 space-y-3">
            {[["TVA collectée (ventes)",data.tvaCollectee,"text-red-600"],["TVA déductible (achats)",data.tvaDeductible,"text-green-700"],["TVA nette",data.tvaNette,data.tvaNette>=0?"text-amber-700":"text-green-700"]].map(([l,v,c])=>(
              <div key={String(l)} className="flex justify-between text-sm border-b border-clay/10 pb-3 last:border-0 last:pb-0">
                <span className="text-moss">{l}</span><span className={`font-mono font-bold ${c}`}>{Number(v).toLocaleString("fr-FR")} XOF</span>
              </div>
            ))}
          </div>
          <div className={`rounded-xl p-5 ${data.aVerser>0?"bg-amber-50 border border-amber-200":"bg-green-50 border border-green-200"}`}>
            <p className="text-sm font-semibold text-ink">{data.aVerser>0?"Montant à verser à la DGI":"Crédit de TVA à reporter"}</p>
            <p className={`text-3xl font-bold font-mono mt-1 ${data.aVerser>0?"text-amber-700":"text-green-700"}`}>{(data.aVerser||data.creditReporte).toLocaleString("fr-FR")} XOF</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">📅 Date limite de dépôt : le 20/{String(month+1).padStart(2,"0")}/{month===12?year+1:year}</div>
          <button className="w-full py-3 bg-cedar text-white rounded-xl font-medium hover:bg-ink transition-colors">Soumettre la déclaration</button>
        </div>
      )}
    </div>
  );
}
