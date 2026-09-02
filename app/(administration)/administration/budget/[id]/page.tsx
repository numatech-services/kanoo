"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
interface Chapter { _id:string; code:string; label:string; level:string; allocatedAmount:number; engagedAmount:number; paidAmount:number; year:number; }
export default function ChapterDetailPage() {
  const { id } = useParams();
  const [chapter,setChapter]=useState<Chapter|null>(null);
  useEffect(()=>{ fetch(`/api/budget/${id}`,{credentials:"include"}).then(r=>r.json()).then(d=>setChapter(d.data)); },[id]);
  if (!chapter) return <div className="p-6"><div className="h-32 bg-white rounded-xl animate-pulse"/></div>;
  const available = chapter.allocatedAmount - chapter.engagedAmount;
  return (
    <div className="space-y-5">
      <div><Link href="/administration/budget" className="text-xs text-moss hover:text-ink">← Budget {chapter.year}</Link><h1 className="text-2xl font-bold text-ink mt-1">{chapter.code} — {chapter.label}</h1></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[{l:"Alloué",v:chapter.allocatedAmount,c:"text-ink"},{l:"Engagé",v:chapter.engagedAmount,c:"text-amber-700"},{l:"Disponible",v:available,c:available<0?"text-red-600":"text-green-700"},{l:"Payé",v:chapter.paidAmount,c:"text-moss"}].map(k=>(
          <div key={k.l} className="bg-white rounded-xl border border-clay/20 p-4"><p className="text-xs text-moss">{k.l}</p><p className={`text-xl font-bold font-mono mt-1 ${k.c}`}>{k.v.toLocaleString("fr-FR")} XOF</p></div>
        ))}
      </div>
    </div>
  );
}
