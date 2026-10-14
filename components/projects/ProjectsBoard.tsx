"use client";

import { ClientFilterChip } from "@/components/shared/ClientFilterChip";
import { useUrlReady } from "@/lib/url-param";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, FolderKanban } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { fullXof } from "@/components/ui/charts/geometry";
import { PROJECT_STATUS_FR, type ProjectVocabulary } from "@/lib/vocabulary";

interface Project {
  _id: string;
  code: string;
  name: string;
  status: string;
  budget: number;
  amountsHidden?: boolean;
  finance?: { cost: number; revenue: number; margin: number };
  spentAmount: number;
  endDate?: string;
  bailleurName?: string;
  tasks?: Array<{ status: string }>;
}

const STATUS_STYLE: Record<string, string> = {
  planning:  "bg-surface2 text-ink2",
  active:    "bg-info-50 text-info",
  on_hold:   "bg-warn-50 text-warn",
  completed: "bg-pos-50 text-pos",
  cancelled: "bg-neg-50 text-neg",
};

/** Vert au-delà de 80 %, ambre à partir de 40 %, rouge en dessous. */
function progressTone(rate: number): string {
  if (rate >= 80) return "bg-pos";
  if (rate >= 40) return "bg-warn";
  return "bg-neg";
}

/**
 * Liste des projets — écran unique pour les trois profils.
 *
 * Il remplace trois implémentations qui appelaient la même API et ne
 * différaient que par un littéral. Le vocabulaire vient de `vocabulary`, le
 * reste est commun.
 */
export function ProjectsBoard({ vocabulary }: { vocabulary: ProjectVocabulary }) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [clientId, setClientId] = useState("");
  const ready = useUrlReady(p => setClientId(p.get("clientId") ?? ""));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter) params.set("status", statusFilter);
      if (clientId) params.set("clientId", clientId);
      if (!ready) return;
      const res = await fetch(`/api/projects?${params}`, { credentials: "include" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Chargement impossible");
      setProjects(d.data?.items || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, clientId, ready]);

  useEffect(() => { load(); }, [load]);

  // Les totaux portent sur les projets chargés (100 au plus, filtre compris),
  // pas sur l'ensemble du portefeuille : l'intitulé le dit.
  const totals = useMemo(() => {
    const budget = projects.reduce((s, p) => s + (p.budget || 0), 0);
    // Coût réel : charges imputées en comptabilité + anciennes saisies manuelles.
    const spent = projects.reduce((s, p) => s + (p.finance?.cost ?? 0) + (p.spentAmount || 0), 0);
    return {
      budget, spent,
      rate: budget > 0 ? Math.round((spent / budget) * 100) : 0,
    };
  }, [projects]);

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-xl bg-section-soft text-section flex items-center justify-center">
              <FolderKanban size={17} />
            </span>
            <h1 className="page-title">{vocabulary.plural}</h1>
          </div>
          <p className="text-sm text-ink2 mt-1">
            {projects.length} {projects.length > 1 ? "projets" : "projet"}
            {statusFilter && ` · filtre : ${PROJECT_STATUS_FR[statusFilter]?.toLowerCase()}`}
          </p>
        </div>
        <button onClick={() => router.push("/projects/new")}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> {vocabulary.createLabel}
        </button>
      </div>

      {error && (
        <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>
      )}

      {/* Budget : gérant et comptabilité seulement (montants masqués par l'API sinon). */}
      {!projects.some(p => p.amountsHidden) && <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label={`Budget cumulé${statusFilter ? " (filtré)" : ""}`}
          value={totals.budget} format={fullXof} />
        <KpiCard label="Dépensé" value={totals.spent} format={fullXof} tone="warn" />
        <KpiCard label="Taux d'exécution budgétaire" value={`${totals.rate} %`}
          tone={totals.rate > 100 ? "neg" : "pos"}
          hint={totals.rate > 100 ? "Dépassement du budget alloué" : "Sur les projets affichés"} />
      </div>}

      {clientId && <ClientFilterChip name={((projects[0] as { clientId?: { name?: string } } | undefined)?.clientId?.name)} onClear={() => setClientId("")} />}
      <SegmentedControl
        ariaLabel="Filtrer par état"
        segments={[
          { value: "", label: "Tous" },
          ...Object.entries(PROJECT_STATUS_FR).map(([value, label]) => ({ value, label })),
        ]}
        value={statusFilter}
        onChange={setStatusFilter}
        size="sm"
      />

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-44 surface-card animate-pulse" />
          ))}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="surface-card p-10 text-center">
          <p className="text-ink2">Aucun projet{statusFilter && " dans cet état"}.</p>
          <button onClick={() => router.push("/projects/new")}
            className="mt-3 text-sm text-section font-medium hover:underline">
            {vocabulary.createLabel}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {!loading && projects.map((p, i) => {
          const tasks = p.tasks || [];
          const tasksDone = tasks.filter(t => {
            const s = t.status?.toLowerCase();
            return s === "done" || s === "completed";
          }).length;
          // Avancement physique : part des tâches terminées. Distinct de la
          // consommation budgétaire — un projet peut avoir dépensé 90 % de son
          // budget pour 30 % du travail, et c'est précisément ce qu'il faut voir.
          const execRate = tasks.length > 0 ? Math.round((tasksDone / tasks.length) * 100) : 0;
          const cost = (p.finance?.cost ?? 0) + (p.spentAmount || 0);
          const budgetRate = p.budget > 0 ? Math.round((cost / p.budget) * 100) : 0;

          return (
            <button key={p._id} type="button"
              onClick={() => router.push(`/projects/${p._id}`)}
              className="surface-card p-5 text-left lift rise"
              style={{ animationDelay: `${Math.min(i, 5) * 40}ms` }}>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <p className="font-bold text-ink truncate">{p.name}</p>
                  <p className="text-[11px] font-mono text-ink3">{p.code}</p>
                  {p.bailleurName && (
                    <p className="text-xs text-ink2 mt-0.5">
                      {vocabulary.funder} : {p.bailleurName}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase shrink-0 ${STATUS_STYLE[p.status] || "bg-surface2 text-ink2"}`}>
                  {PROJECT_STATUS_FR[p.status] || p.status}
                </span>
              </div>

              <div className="mb-3">
                <div className="flex justify-between text-[10px] font-bold text-ink2 mb-1">
                  <span>AVANCEMENT PHYSIQUE</span>
                  <span className="num">{execRate}&nbsp;%</span>
                </div>
                <div className="h-2 bg-line rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${progressTone(execRate)}`}
                    style={{ width: `${execRate}%` }} />
                </div>
              </div>

              {!p.amountsHidden && <div>
                <div className="flex justify-between text-[10px] font-bold text-ink2 mb-1">
                  <span>BUDGET CONSOMMÉ</span>
                  <span className={`num ${budgetRate > 100 ? "text-neg" : ""}`}>{budgetRate}&nbsp;%</span>
                </div>
                <div className="h-1.5 bg-line rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${budgetRate > 100 ? "bg-neg" : "bg-info"}`}
                    style={{ width: `${Math.min(budgetRate, 100)}%` }} />
                </div>
                <p className="text-[10px] text-right mt-1 text-ink3 num">
                  {cost.toLocaleString("fr-FR")} / {(p.budget || 0).toLocaleString("fr-FR")} FCFA
                </p>
              </div>}

              <div className="flex justify-between text-[10px] font-bold text-ink2 pt-3 mt-3 border-t border-line">
                <span>{tasksDone}/{tasks.length} tâches</span>
                <span>Fin : {p.endDate ? new Date(p.endDate).toLocaleDateString("fr-FR") : "—"}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
