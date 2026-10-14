"use client";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-class";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
export default function CNSSPage() {
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth()+1)/3);
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(currentQ);
  const inp = "px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30";
  return (
    <div className="space-y-6 max-w-2xl">
      <ScreenTabs group="fiscalite" />
      <div>
        <div className="flex items-center gap-2 text-sm text-ink2 mb-2"><a href="/fiscalite" className="hover:text-ink">Fiscalité</a><span>→</span><span className="text-ink font-medium">CNSS</span></div>
        <h1 className="page-title">Déclaration CNSS</h1>
        <p className="text-sm text-ink2 mt-1">CNSS salarié 3,6% + patronal 16,4% = 20% total</p>
      </div>
      <div className="flex gap-3">
        <select value={quarter} onChange={e=>setQuarter(Number(e.target.value))} className={inp}>{[1,2,3,4].map(q=><option key={q} value={q}>T{q}</option>)}</select>
        <select value={year} onChange={e=>setYear(Number(e.target.value))} className={inp}>{[year-1,year,year+1].map(y=><option key={y} value={y}>{y}</option>)}</select>
      </div>
      <div className="bg-surface rounded-xl border border-line p-5">
        <h2 className="font-semibold text-ink mb-4">Bordereau CNSS — T{quarter}/{year}</h2>
        <p className="text-sm text-ink2 text-center py-8">Généré automatiquement depuis les bulletins de paie. Générez des bulletins pour ce trimestre d'abord.</p>
        <button className={buttonClass("primary", "md", "w-full mt-2")}>Générer le bordereau PDF</button>
      </div>
      <div className="bg-info-50 border border-info/25 rounded-xl p-3 text-xs text-info">Date limite CNSS : 10 jours après la fin du trimestre (10/{[3,6,9,12][quarter-1]+1 > 12 ? "01" : String([3,6,9,12][quarter-1]+1).padStart(2,"0")}/{[3,6,9,12][quarter-1]===12?year+1:year})</div>
    </div>
  );
}
