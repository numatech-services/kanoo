"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
interface AG { _id:string; title:string; type:string; date:string; location:string; quorumRequired:number; quorumAchieved:number; decisions:Array<{text:string;passed:boolean}>; }
export default function AssembleePage() {
  const [mounted,setMounted]=useState(false);
  const [items,setItems]=useState<AG[]>([]); const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);const res=await fetch("/api/assemblee",{credentials:"include"});const d=await res.json();setItems(d.data?.items||[]);setLoading(false);},[]);
  useEffect(()=>{setMounted(true);load();},[load]);
  const columns: Column<AG>[] = [
    {key:"title",label:"Intitulé"},
    {key:"type",label:"Type",render:(v)=><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v==="ordinary"?"bg-blue-100 text-blue-700":"bg-amber-100 text-amber-700"}`}>{v==="ordinary"?"Ordinaire":"Extraordinaire"}</span>},
    {key:"date",label:"Date",render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR")},
    {key:"location",label:"Lieu"},
    {key:"quorumAchieved",label:"Quorum",render:(v,r)=><span className={Number(v)>=r.quorumRequired?"text-green-700":"text-red-600"}>{Number(v)}/{r.quorumRequired}</span>},
    {key:"decisions",label:"Résolutions",render:(v)=>{const d=v as AG["decisions"];return `${d.filter(x=>x.passed).length}/${d.length} adoptées`;}},
  ];
  if (!mounted) return null;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold text-ink">Assemblées générales</h1><button onClick={() => window.location.href = "/associations/assemblee/new"} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Convoquer une AG</button></div>
      <DataTable columns={columns} data={items} loading={loading} keyExtractor={a=>a._id} emptyMessage="Aucune assemblée générale"/>
    </div>
  );
}
