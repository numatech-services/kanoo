"use client";
import { useState, useEffect } from "react";
export default function CNSSPage() {
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth()+1)/3);
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(currentQ);
  const inp = "px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 text-sm text-moss mb-2"><a href="/fiscalite" className="hover:text-ink">Fiscalité</a><span>→</span><span className="text-ink font-medium">CNSS</span></div>
        <h1 className="text-2xl font-bold text-ink">Déclaration CNSS</h1>
        <p className="text-sm text-moss mt-1">CNSS salarié 3,6% + patronal 16,4% = 20% total</p>
      </div>
      <div className="flex gap-3">
        <select value={quarter} onChange={e=>setQuarter(Number(e.target.value))} className={inp}>{[1,2,3,4].map(q=><option key={q} value={q}>T{q}</option>)}</select>
        <select value={year} onChange={e=>setYear(Number(e.target.value))} className={inp}>{[year-1,year,year+1].map(y=><option key={y} value={y}>{y}</option>)}</select>
      </div>
      <div className="bg-white rounded-xl border border-clay/20 p-5">
        <h2 className="font-semibold text-ink mb-4">Bordereau CNSS — T{quarter}/{year}</h2>
        <p className="text-sm text-moss text-center py-8">Généré automatiquement depuis les bulletins de paie. Générez des bulletins pour ce trimestre d'abord.</p>
        <button className="w-full py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink mt-2">Générer le bordereau PDF</button>
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">📅 Date limite CNSS : 10 jours après la fin du trimestre (10/{[3,6,9,12][quarter-1]+1 > 12 ? "01" : String([3,6,9,12][quarter-1]+1).padStart(2,"0")}/{[3,6,9,12][quarter-1]===12?year+1:year})</div>
    </div>
  );
}
