"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Column } from "@/components/ui/DataTable";
import { useApi } from "@/lib/use-api";
import { buttonClass } from "@/components/ui/button-class";
import { PageLoading } from "@/components/ui/PageState";
interface AG { _id:string; title:string; type:string; date:string; location:string; quorumRequired:number; quorumAchieved:number; decisions:Array<{text:string;passed:boolean}>; }
// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};
export default function AssembleePage() {
  const router=useRouter();
  const mounted=useSyncExternalStore(noSubscribe,()=>true,()=>false);
  const {data:items,loading}=useApi<AG[]>("/api/assemblee",d=>d.data?.items||[],[]);
  const columns: Column<AG>[] = [
    {key:"title",label:"Intitulé"},
    {key:"type",label:"Type",render:(v)=><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v==="ordinary"?"bg-info-50 text-info":"bg-warn-50 text-warn"}`}>{v==="ordinary"?"Ordinaire":"Extraordinaire"}</span>},
    {key:"date",label:"Date",render:(v)=>new Date(String(v)).toLocaleDateString("fr-FR")},
    {key:"location",label:"Lieu"},
    {key:"quorumAchieved",label:"Quorum",render:(v,r)=><span className={Number(v)>=r.quorumRequired?"text-pos":"text-neg"}>{Number(v)}/{r.quorumRequired}</span>},
    {key:"decisions",label:"Résolutions",render:(v)=>{const d=v as AG["decisions"];return `${d.filter(x=>x.passed).length}/${d.length} adoptées`;}},
  ];
  if (!mounted) return <PageLoading />;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="page-title">Assemblées générales</h1><Link href="/associations/assemblee/new" className={buttonClass("primary", "md")}>+ Convoquer une AG</Link></div>
      <DataTable columns={columns} data={items} loading={loading} keyExtractor={a=>a._id} emptyMessage="Aucune assemblée générale" onRowClick={a=>router.push(`/associations/assemblee/${a._id}`)}/>
    </div>
  );
}
