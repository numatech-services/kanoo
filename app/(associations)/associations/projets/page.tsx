"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Project { 
  _id: string; 
  code: string; 
  name: string; 
  status: string; 
  budget: number; 
  spentAmount: number; 
  endDate?: string; 
  bailleurName?: string; 
  tasks: Array<{ status: string }>; 
}

const STATUS_FR: Record<string, string> = { 
  planning: "Planification", active: "En cours", on_hold: "En pause", completed: "Terminé", cancelled: "Annulé" 
};

const STATUS_COLOR: Record<string, string> = { 
  planning: "bg-gray-100 text-gray-600", active: "bg-blue-100 text-blue-700", on_hold: "bg-amber-100 text-amber-700", completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-600" 
};

// Fonction pour déterminer la couleur de la barre
const getExecColor = (r: number) => r >= 80 ? "bg-green-500" : r >= 40 ? "bg-amber-400" : "bg-red-400";

export default function ProjetsONGPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/projects?${params}`);
      const d = await res.json();
      setProjects(d.data?.items || []);
    } catch (err) {
      console.error("Erreur:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { setMounted(true); load(); }, [load]);

  if (!mounted) return null;

  // --- CALCULS GLOBAUX ---
  const totalBudget = projects.reduce((s, p) => s + (p.budget || 0), 0);
  const totalSpent = projects.reduce((s, p) => s + (p.spentAmount || 0), 0);
  
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Projets / ONG</h1>
          <p className="text-sm text-moss">{projects.length} projet(s)</p>
        </div>
        <button onClick={() => router.push("/associations/projets/new")} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">
          + Nouveau projet
        </button>
      </div>

      {/* Filtres */}
      <div className="flex gap-2 flex-wrap">
        {(["", "planning", "active", "on_hold", "completed", "cancelled"] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${statusFilter === s ? "bg-cedar text-white" : "bg-white text-moss border border-clay/20"}`}>
            {s ? STATUS_FR[s].toUpperCase() : "TOUS"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {!loading && projects.map(p => {
          // --- LOGIQUE DE CALCUL ROBUSTE ---
          const tasksTotal = p.tasks?.length || 0;
          
          // On vérifie le statut en majuscule ET en minuscule pour ne rien rater
          const tasksDone = p.tasks?.filter(t => {
            const s = t.status?.toLowerCase();
            return s === "done" || s === "completed" || s === "terminé";
          }).length || 0;

          const execRate = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;
          const budgetRate = p.budget > 0 ? Math.round((p.spentAmount / p.budget) * 100) : 0;

          return (
            <div key={p._id} onClick={() => router.push(`/associations/projets/${p._id}`)} className="bg-white rounded-xl border border-clay/20 p-5 hover:shadow-md cursor-pointer transition-all">
              <div className="flex justify-between mb-4">
                <p className="font-bold text-ink">{p.name}</p>
                <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${STATUS_COLOR[p.status]}`}>
                  {STATUS_FR[p.status]}
                </span>
              </div>

              {/* Avancement Physique */}
              <div className="mb-4">
                <div className="flex justify-between text-[10px] font-bold text-moss mb-1">
                  <span>AVANCEMENT PHYSIQUE</span>
                  <span>{execRate}%</span>
                </div>
                <div className="h-2 bg-sand rounded-full overflow-hidden">
                  <div className={`h-full ${getExecColor(execRate)} transition-all`} style={{ width: `${execRate}%` }} />
                </div>
              </div>

              {/* Budget */}
              <div className="mb-4">
                <div className="flex justify-between text-[10px] font-bold text-moss mb-1">
                  <span>BUDGET CONSOMMÉ</span>
                  <span className={budgetRate > 100 ? "text-red-500" : ""}>{budgetRate}%</span>
                </div>
                <div className="h-1.5 bg-sand rounded-full overflow-hidden">
                  <div className={`h-full ${budgetRate > 100 ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${Math.min(budgetRate, 100)}%` }} />
                </div>
                <p className="text-[9px] text-right mt-1 text-moss font-mono">
                   {p.spentAmount.toLocaleString()} / {p.budget.toLocaleString()} XOF
                </p>
              </div>

              <div className="flex justify-between text-[10px] font-bold text-moss pt-3 border-t">
                <span>📋 {tasksDone}/{tasksTotal} TÂCHES</span>
                <span>FIN : {p.endDate ? new Date(p.endDate).toLocaleDateString() : "-"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}