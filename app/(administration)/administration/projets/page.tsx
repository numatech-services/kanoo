"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Project { _id:string; code:string; name:string; status:string; executionRate:number; budgetRate:number; budget:number; spentAmount:number; startDate?:string; endDate?:string; tasks:Array<{status:string}>; documents:Array<{_id:string}>; }

const STATUS_FR: Record<string,string> = { planning:"Planification", active:"En cours", on_hold:"En pause", completed:"Terminé", cancelled:"Annulé" };
const STATUS_COL: Record<string,string> = { planning:"bg-gray-100 text-gray-600", active:"bg-blue-100 text-blue-700", on_hold:"bg-amber-100 text-amber-700", completed:"bg-green-100 text-green-700", cancelled:"bg-red-100 text-red-600" };
const execColor = (r:number) => r>=80?"bg-green-500":r>=50?"bg-amber-400":"bg-red-400";

export default function ProjetsAdminPage() {
  const [mounted, setMounted] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit:"50" });
    if (status) params.set("status", status);
    const res = await fetch(`/api/projects?${params}`, { credentials:"include" });
    const d = await res.json();
    setProjects(d.data?.items || []);
    setLoading(false);
  }, [status]);
  useEffect(() => { setMounted(true); load(); }, [load]);

  const totalBudget = projects.reduce((s,p) => s+p.budget, 0);
  const avgExec = projects.length > 0 ? Math.round(projects.reduce((s,p) => s+p.executionRate, 0) / projects.length) : 0;

  if (!mounted) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Projets & Suivi d'exécution</h1><p className="text-sm text-moss">{projects.length} projet{projects.length>1?"s":""}</p></div>
        <Link href="/administration/projets/new" className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Nouveau projet</Link>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-clay/20 p-4"><p className="text-xs text-moss">Projets</p><p className="text-2xl font-bold text-ink mt-1">{projects.length}</p></div>
        <div className="bg-white rounded-xl border border-clay/20 p-4"><p className="text-xs text-moss">Budget total</p><p className="text-2xl font-bold font-mono text-ink mt-1">{(totalBudget/1_000_000).toFixed(1)}M</p></div>
        <div className="bg-white rounded-xl border border-clay/20 p-4"><p className="text-xs text-moss">Taux d'exécution moyen</p><p className={`text-2xl font-bold mt-1 ${avgExec>=60?"text-green-700":"text-amber-600"}`}>{avgExec}%</p></div>
        <div className="bg-white rounded-xl border border-clay/20 p-4"><p className="text-xs text-moss">En cours</p><p className="text-2xl font-bold text-blue-700 mt-1">{projects.filter(p=>p.status==="active").length}</p></div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["","planning","active","on_hold","completed","cancelled"] as const).map(s => (
          <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${status===s?"bg-cedar text-white":"border border-clay/30 text-moss hover:border-cedar/40"}`}>
            {s ? STATUS_FR[s] : "Tous"}
          </button>
        ))}
      </div>

      {loading
        ? <div className="space-y-3">{[...Array(3)].map((_,i)=><div key={i} className="h-20 bg-white rounded-xl animate-pulse border border-clay/20"/>)}</div>
        : projects.length === 0
        ? <div className="bg-white rounded-xl border border-clay/20 p-12 text-center"><p className="text-4xl mb-3">📋</p><p className="text-moss">Aucun projet trouvé</p></div>
        : (
          <div className="space-y-3">
            {projects.map(p => {
              const tasksDone = p.tasks.filter(t => t.status==="done").length;
              return (
                <Link key={p._id} href={`/administration/projets/${p._id}`} className="bg-white rounded-xl border border-clay/20 p-5 hover:border-cedar/40 transition-all flex items-center gap-6 block">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-xs text-moss">{p.code}</span>
                      <p className="font-semibold text-ink truncate">{p.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COL[p.status]||""}`}>{STATUS_FR[p.status]}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex justify-between text-xs text-moss mb-1"><span>Taux d'exécution</span><span className="font-mono font-bold">{p.executionRate}%</span></div>
                        <div className="h-2 bg-sand rounded-full"><div className={`h-2 rounded-full ${execColor(p.executionRate)}`} style={{width:`${p.executionRate}%`}}/></div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-moss mb-1"><span>Budget</span><span className="font-mono">{p.budgetRate}%</span></div>
                        <div className="h-2 bg-sand rounded-full"><div className={`h-2 rounded-full ${p.budgetRate>100?"bg-red-500":p.budgetRate>80?"bg-amber-400":"bg-blue-400"}`} style={{width:`${Math.min(p.budgetRate,100)}%`}}/></div>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-moss">{tasksDone}/{p.tasks.length} tâches</p>
                    <p className="text-xs text-moss">{p.documents.length} doc{p.documents.length>1?"s":""}</p>
                    {p.endDate && <p className="text-xs text-moss">Fin : {new Date(p.endDate).toLocaleDateString("fr-FR")}</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        )
      }
    </div>
  );
}
