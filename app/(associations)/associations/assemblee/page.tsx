"use client";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Column } from "@/components/ui/DataTable";
import { apiJson } from "@/lib/api-client";
import { buttonClass } from "@/components/ui/button-class";
interface AG { _id:string; title:string; type:string; date:string; location:string; quorumRequired:number; quorumAchieved:number; decisions:Array<{text:string;passed:boolean}>; }
export default function AssembleePage() {
  const router=useRouter();
  const [mounted,setMounted]=useState(false);
  const [items,setItems]=useState<AG[]>([]); const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);const d = await apiJson("/api/assemblee");setItems(d.data?.items||[]);setLoading(false);},[]);
  useEffect(()=>{setMounted(true);load();},[load]);
  const columns: Column<AG>[] = [
    {key:"title",label:"Intitulé"},
    {key:"type",label:"Type",render:(v)=><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v==="ordinary"?"bg-info-50 text-info":"bg-warn-50 text-warn"}`}>{v==="ordinary"?"Ordinaire":"Extraordinaire"}</span>},
    {key:"date",label:"Date",render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR")},
    {key:"location",label:"Lieu"},
    {key:"quorumAchieved",label:"Quorum",render:(v,r)=><span className={Number(v)>=r.quorumRequired?"text-pos":"text-neg"}>{Number(v)}/{r.quorumRequired}</span>},
    {key:"decisions",label:"Résolutions",render:(v)=>{const d=v as AG["decisions"];return `${d.filter(x=>x.passed).length}/${d.length} adoptées`;}},
  ];
  if (!mounted) return null;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="page-title">Assemblées générales</h1><Link href="/associations/assemblee/new" className={buttonClass("primary", "md")}>+ Convoquer une AG</Link></div>
      <DataTable columns={columns} data={items} loading={loading} keyExtractor={a=>a._id} emptyMessage="Aucune assemblée générale" onRowClick={a=>router.push(`/associations/assemblee/${a._id}`)}/>
    </div>
  );
}
