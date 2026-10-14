"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { MessageComposer } from "@/components/shared/MessageComposer";
import { CheckCircle2, AlertCircle, Banknote, ClipboardList, Plus, Trash2, Edit3, Flag, FileText } from "lucide-react";
import { useMe, meCanDo } from "@/lib/useMe";
import { ImputedFlows } from "@/components/shared/ImputedFlows";
import { ProjectEditForm, type ProjectEditValue } from "@/components/projects/ProjectEditForm";
import { PROJECT_STATUS_FR, TASK_STATUS_FR, type ProjectVocabulary } from "@/lib/vocabulary";

import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken } from "@/lib/api-client";
// ── Interfaces ────────────────────────────────────────────────────
interface Task { _id: string; label: string; status: string; weight: number; }
interface Milestone { _id?: string; label: string; dueDate?: string; completedAt?: string; amount?: number; description?: string; }
interface ProjectDoc { _id: string; name: string; type: string; uploadedAt: string; url?: string; }
interface BureauMember { _id: string; firstName: string; lastName: string; role: string; }
interface ProjectMember { 
  _id: string; 
  userId?: { firstName: string; lastName: string }; 
  memberId?: { firstName: string; lastName: string }; 
  bureauMemberId?: { firstName: string; lastName: string };
  role: string; 
}
interface Project {
  _id: string; code: string; name: string; status: string; budget: number;
  spentAmount: number; budgetRate: number; executionRate: number;
  /** Montants masqués par l'API : le compte n'a pas accès aux finances. */
  amountsHidden?: boolean;
  /** Coût et recettes réels, lus dans la comptabilité (lignes imputées au projet). */
  finance?: { cost: number; revenue: number; margin: number };
  milestones?: Milestone[];
  description?: string; projectType?: string; bailleurName?: string; startDate?: string; endDate?: string;
  clientId?: string | { _id: string } | null; managerId?: string | { _id: string } | null;
  tasks: Task[]; documents: ProjectDoc[]; projectMembers: ProjectMember[];
  conversationId?: string;
}

// Les libellés viennent de lib/vocabulary : la table locale mélangeait états
// de projet et états de tâche sous les mêmes clés.
const STATUS_FR: Record<string, string> = { ...PROJECT_STATUS_FR, ...TASK_STATUS_FR };

/**
 * Fiche projet — écran unique pour les trois profils.
 *
 * Cette implémentation vivait sous `/projects/[id]` : 454 lignes
 * avec tâches, documents, équipe et messagerie. Les PME avaient droit à 105
 * lignes sans rien de tout cela, pour exactement les mêmes données. En
 * unifiant, les trois profils héritent du meilleur des trois écrans.
 *
 * Seul le vocabulaire change — et la source des personnes assignables, qui est
 * la seule vraie différence de comportement : une association affecte des
 * membres du bureau, une entreprise des collaborateurs.
 */
export function ProjectDetail({ vocabulary }: { vocabulary: ProjectVocabulary }) {
  const { id } = useParams();
  const router = useRouter();
  const me = useMe();
  const canEdit = meCanDo(me, "projects", "update");
  const canDelete = meCanDo(me, "projects", "delete");
  const canBuy = meCanDo(me, "purchases", "create");
  const [editOpen, setEditOpen] = useState(false);
  const [msModal, setMsModal] = useState(false);
  const [newMs, setNewMs] = useState<Milestone>({ label: "", dueDate: "", amount: 0 });

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [userId, setUserId] = useState("");
  const [activeTab, setActiveTab] = useState<"tasks" | "milestones" | "docs" | "team" | "messages">("tasks");

  // Modales
  const [taskModal, setTaskModal] = useState(false);
  const [newTask, setNewTask] = useState({ label: "", weight: 1, status: "todo" });
  const [docModal, setDocModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [newDoc, setNewDoc] = useState({ name: "", type: "rapport" });
  const [memberModal, setMemberModal] = useState(false);
  const [bureauMembers, setBureauMembers] = useState<BureauMember[]>([]);
  const [newMember, setNewMember] = useState({ userId: "", role: "contributor" });

  const fetchData = useCallback(async () => {
    try {
      const [authRes, projRes] = await Promise.all([
        fetch("/api/auth/me", { credentials: "include" }),
        fetch(`/api/projects/${id}`, { credentials: "include" })
      ]);
      const authData = await authRes.json();
      const projData = await projRes.json();
      setUserId(authData.data?.user?._id || "");
      setProject(projData.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    setMounted(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (memberModal) {
      fetch(vocabulary.teamEndpoint, { credentials: "include" })
        .then(r => r.json())
        .then(d => setBureauMembers(d.data?.items || d.data || []));
    }
  }, [memberModal, vocabulary.teamEndpoint]);

  if (!mounted) return null;
  if (loading || !project) return <div className="p-10 text-ink2 font-medium italic">Chargement du projet...</div>;

  // --- CALCULS EN TEMPS RÉEL (POUR L'UI ET LA CLÔTURE) ---
  const tasksTotal = project.tasks?.length || 0;
  const tasksDone = project.tasks?.filter(t => {
    const s = t.status?.toLowerCase();
    return s === "done" || s === "completed";
  }).length || 0;
  
  // Avancement pondéré par le poids des tâches (même calcul que le serveur).
  const totalWeight = project.tasks?.reduce((s, t) => s + (t.weight || 1), 0) || 0;
  const doneWeight = project.tasks?.filter(t => t.status === "done" || t.status === "completed").reduce((s, t) => s + (t.weight || 1), 0) || 0;
  const currentExecRate = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0;
  const money = !project.amountsHidden;
  // Coût réel = charges imputées au projet en comptabilité (+ anciennes saisies manuelles).
  const realCost = (project.finance?.cost ?? 0) + (project.spentAmount || 0);
  const currentBudgetRate = money && project.budget > 0 ? Math.round((realCost / project.budget) * 100) : 0;

  const getCsrf = async () => {
    const csrfToken = await getCsrfToken();
    return csrfToken;
  };

  // --- ACTIONS ---

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    const csrf = await getCsrf();
    const updatedTasks = project.tasks.map(t => t._id === taskId ? { ...t, status: newStatus } : t);
    
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ tasks: updatedTasks }),
      credentials: "include"
    });
    fetchData();
  };

  const patchProject = async (body: Record<string, unknown>) => {
    const csrf = await getCsrf();
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body), credentials: "include",
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Modification impossible");
    await fetchData();
  };

  const deleteTask = async (taskId: string) => {
    if (!(await confirmDialog({ title: "Supprimer cette tâche ?", danger: true }))) return;
    await patchProject({ tasks: project.tasks.filter(t => t._id !== taskId) });
  };

  const deleteProject = async () => {
    if (!(await confirmDialog({ title: "Supprimer définitivement ce projet ?", message: "Ses tâches et documents disparaissent ; les écritures comptables imputées restent.", danger: true }))) return;
    const csrf = await getCsrf();
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE", headers: { "x-csrf-token": csrf }, credentials: "include" });
    if (res.ok) router.push("/projects"); else showToast("Suppression impossible", "error");
  };

  const saveMilestones = (milestones: Milestone[]) => patchProject({ milestones });

  const completeProject = async () => {
    if (currentExecRate < 100) return;
    const csrf = await getCsrf();
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ status: "completed", completedAt: new Date() }),
      credentials: "include"
    });
    fetchData();
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const csrf = await getCsrf();
    // Pas d'identifiant provisoire : Mongo attribue le sien (« temp-… » faisait échouer l'enregistrement).
    const tasks = [...project.tasks, { ...newTask }];
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ tasks }),
      credentials: "include"
    });
    setTaskModal(false);
    setNewTask({ label: "", weight: 1, status: "todo" });
    fetchData();
  };

  const addDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    const csrf = await getCsrf();
    const fd = new FormData();
    fd.append("file", selectedFile);
    fd.append("name", newDoc.name || selectedFile.name);
    fd.append("type", newDoc.type);

    await fetch(`/api/projects/${id}/documents`, {
      method: "POST",
      headers: { "x-csrf-token": csrf },
      body: fd,
      credentials: "include"
    });
    setDocModal(false);
    setSelectedFile(null);
    fetchData();
  };

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMember.userId) return;
    const csrf = await getCsrf();
    const projectMembers = [...project.projectMembers, { userId: newMember.userId, role: newMember.role }];
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ projectMembers }),
      credentials: "include"
    });
    setMemberModal(false);
    fetchData();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 pb-20">
      {/* HEADER */}
      <div className="flex justify-between items-end border-b border-line pb-4">
        <div>
          <Link href="/projects" className="text-xs font-bold text-ink2 hover:text-section transition-colors">← {vocabulary.plural.toUpperCase()}</Link>
          <h1 className="page-title mt-2">{project.name}</h1>
          <p className="text-ink2 font-mono text-xs opacity-70">{project.code}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {canEdit && <button onClick={() => setEditOpen(true)} className="px-3 h-9 inline-flex items-center gap-1.5 rounded-lg border border-line2 text-sm hover:bg-surface2"><Edit3 size={14} /> Modifier</button>}
          {canDelete && <button onClick={deleteProject} className="px-3 h-9 inline-flex items-center gap-1.5 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50"><Trash2 size={14} /> Supprimer</button>}
          <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${project.status === 'completed' ? 'bg-pos-50 text-pos' : 'bg-surface2 text-ink'}`}>
            {STATUS_FR[project.status] || project.status}
          </div>
        </div>
      </div>

      {/* DASHBOARD PROGRESS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="surface-card p-5">
          <div className="flex justify-between items-center mb-3">
            <span className="text-[10px] font-bold uppercase text-ink2 flex items-center gap-1">
              <ClipboardList size={14} /> Avancement Physique
            </span>
            <span className="font-mono font-bold text-ink">{currentExecRate}%</span>
          </div>
          <div className="h-2 bg-surface2 rounded-full overflow-hidden">
            <div className="h-full bg-pos transition-all duration-700" style={{ width: `${currentExecRate}%` }} />
          </div>
        </div>

        {money && <div className="surface-card p-5">
          <div className="flex justify-between items-center mb-3">
            <span className="text-[10px] font-bold uppercase text-ink2 flex items-center gap-1">
              <Banknote size={14} /> Consommation Budget
            </span>
            <span className="font-mono font-bold text-ink">{currentBudgetRate}%</span>
          </div>
          <div className="h-2 bg-surface2 rounded-full overflow-hidden">
            <div className={`h-full transition-all duration-700 ${currentBudgetRate > 100 ? 'bg-neg' : 'bg-section'}`} style={{ width: `${Math.min(currentBudgetRate, 100)}%` }} />
          </div>
        </div>}

        {money && <div className="bg-section/5 p-5 rounded-xl border border-section/10 space-y-1 text-sm">
            <p className="text-[10px] font-black text-section uppercase mb-1">Finances du projet</p>
            <p className="flex justify-between"><span className="text-ink2">Budget</span><span className="font-mono">{(project.budget || 0).toLocaleString("fr-FR")}</span></p>
            <p className="flex justify-between"><span className="text-ink2">Coût réel</span><span className="font-mono">{realCost.toLocaleString("fr-FR")}</span></p>
            <p className="flex justify-between"><span className="text-ink2">Recettes facturées</span><span className="font-mono">{(project.finance?.revenue ?? 0).toLocaleString("fr-FR")}</span></p>
            <p className={`flex justify-between font-bold ${(project.finance?.revenue ?? 0) - realCost < 0 ? "text-neg" : "text-pos"}`}><span>Marge</span><span className="font-mono">{((project.finance?.revenue ?? 0) - realCost).toLocaleString("fr-FR")} FCFA</span></p>
            {project.spentAmount > 0 && <p className="text-[10px] text-ink3">dont {project.spentAmount.toLocaleString("fr-FR")} saisis à la main (avant l&apos;imputation comptable)</p>}
            {canBuy && <Link href={`/depenses/nouvelle?projectId=${project._id}`} className="mt-2 text-[11px] font-bold text-section inline-flex items-center gap-1 hover:underline"><Plus size={11} /> Imputer une dépense à ce projet</Link>}
        </div>}
      </div>

      {/* ALERTES GESTION */}
      {money && currentBudgetRate > currentExecRate + 15 && (
        <div className="bg-neg-50 border border-neg/25 p-4 rounded-2xl flex gap-3 items-center animate-pulse">
          <AlertCircle className="text-neg" size={20} />
          <p className="text-[11px] text-neg font-bold uppercase tracking-tight">
            Alerte : Le budget est consommé plus vite que l'avancement réel du projet.
          </p>
        </div>
      )}

      {money && <ImputedFlows projectId={String(project._id)} />}

      {/* TABS NAVIGATION */}
      <div className="flex gap-2 bg-surface2/30 p-1.5 rounded-2xl w-fit">
        {["tasks", "milestones", "docs", "team", "messages"].map((t) => (
          <button key={t} onClick={() => setActiveTab(t as any)} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === t ? "bg-surface text-section shadow-sm" : "text-ink2 hover:bg-white/50"}`}>
            {t === "tasks" ? "Tâches" : t === "milestones" ? "Jalons" : t === "docs" ? "Documents" : t === "team" ? "Équipe" : "Messages"}
          </button>
        ))}
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="bg-surface rounded-xl border border-line p-8 min-h-[400px] shadow-sm relative">
        {activeTab === "tasks" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black text-ink">LISTE DES TÂCHES</h2>
              <button onClick={() => setTaskModal(true)} className="bg-section text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest">+ Ajouter</button>
            </div>
            <div className="divide-y divide-line">
              {project.tasks.map(task => (
                <div key={task._id} className="py-4 flex justify-between items-center group">
                  <div className="flex items-center gap-3">
                    {(task.status === 'done' || task.status === 'completed') ? <CheckCircle2 size={20} className="text-pos" /> : <div className="w-[20px] h-[20px] border-2 border-line rounded-full" />}
                    <p className={`text-sm font-bold ${task.status === "done" ? "line-through text-ink2 opacity-50" : "text-ink"}`}>{task.label}</p>
                  </div>
                  <select 
                    value={task.status} 
                    onChange={(e) => updateTaskStatus(task._id, e.target.value)}
                    className="text-[10px] font-black border-0 bg-surface2/40 rounded-lg px-3 py-2 cursor-pointer uppercase hover:bg-surface2 transition-all outline-none"
                  >
                    <option value="todo">À faire</option>
                    <option value="in_progress">En cours</option>
                    <option value="done">Terminé</option>
                    <option value="blocked">Bloqué</option>
                  </select>
                  {canEdit && <button onClick={() => deleteTask(task._id)} title="Supprimer la tâche" className="ml-2 p-1.5 text-ink3 hover:text-neg"><Trash2 size={14} /></button>}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "milestones" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black text-ink">JALONS</h2>
              {canEdit && <button onClick={() => setMsModal(true)} className="bg-section text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest">+ Jalon</button>}
            </div>
            {(project.milestones ?? []).length === 0 && <p className="text-sm text-ink3">Aucun jalon. Un jalon marque une étape (livraison, validation, facturation).</p>}
            <div className="divide-y divide-line">
              {(project.milestones ?? []).map((m, i) => (
                <div key={m._id ?? i} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Flag size={16} className={m.completedAt ? "text-pos" : "text-ink3"} />
                    <div>
                      <p className={`text-sm font-semibold ${m.completedAt ? "text-ink2 line-through" : "text-ink"}`}>{m.label}</p>
                      <p className="text-[11px] text-ink3">
                        {m.dueDate ? `Échéance ${new Date(m.dueDate).toLocaleDateString("fr-FR")}` : "Sans échéance"}
                        {money && m.amount ? ` · ${m.amount.toLocaleString("fr-FR")} FCFA à facturer` : ""}
                        {m.completedAt ? ` · atteint le ${new Date(m.completedAt).toLocaleDateString("fr-FR")}` : ""}
                      </p>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => saveMilestones((project.milestones ?? []).map((x, j) => j === i ? { ...x, completedAt: x.completedAt ? undefined : new Date().toISOString() } : x))}
                        className="px-2 h-8 rounded-md border border-line2 text-xs hover:bg-surface2">{m.completedAt ? "Rouvrir" : "Atteint"}</button>
                      <button onClick={async () => { if (await confirmDialog({ title: "Supprimer ce jalon ?", danger: true })) saveMilestones((project.milestones ?? []).filter((_, j) => j !== i)); }} className="p-1.5 text-ink3 hover:text-neg" title="Supprimer"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "team" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black text-ink">ÉQUIPE DU PROJET</h2>
              <button onClick={() => setMemberModal(true)} className="bg-section text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest">+ Nouveau</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {project.projectMembers.map((pm) => {
                const person = pm.userId || pm.memberId || pm.bureauMemberId;
                return (
                  <div key={pm._id} className="flex items-center gap-4 p-4 border border-line rounded-2xl bg-surface2/5">
                    <div className="w-10 h-10 bg-section/10 text-section rounded-full flex items-center justify-center font-black uppercase text-xs">
                      {person?.firstName?.[0] || ""}{person?.lastName?.[0] || ""}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ink">
                        {person?.firstName ? `${person.firstName} ${person.lastName}` : "Utilisateur"}
                      </p>
                      <p className="text-[10px] text-ink2 font-black uppercase tracking-tighter opacity-70">
                        {pm.role || "Contributeur"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "docs" && (
           <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-black text-ink">PIÈCES JOINTES</h2>
                <button onClick={() => setDocModal(true)} className="bg-section text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest">+ PDF</button>
              </div>
              <div className="grid gap-3">
                {project.documents.map(doc => (
                  <div key={doc._id} className="flex items-center justify-between p-4 bg-surface2/10 rounded-2xl border border-line hover:bg-surface2/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex" aria-hidden><FileText size={20} /></span>
                      <div>
                        <p className="font-bold text-ink text-sm">{doc.name}</p>
                        <p className="text-[10px] text-ink2 font-black uppercase">{doc.type}</p>
                      </div>
                    </div>
                    {doc.url && (
                      <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-section font-black text-[10px] uppercase hover:underline">
                        Ouvrir ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
           </div>
        )}

        {activeTab === "messages" && userId && (
          <div className="h-[500px]">
             <MessageComposer currentUserId={userId} conversationId={project.conversationId} compact />
          </div>
        )}
      </div>

      {/* BOUTON DE CLÔTURE DYNAMIQUE */}
      {project.status !== "completed" && (
        <div className="flex justify-end pt-8">
           <button 
             onClick={completeProject}
             disabled={currentExecRate < 100}
             className={`px-12 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.3em] transition-all shadow-xl ${
               currentExecRate === 100 
               ? "bg-pos text-white hover:brightness-95 hover:-translate-y-1 active:translate-y-0" 
               : "bg-surface2 text-ink2 cursor-not-allowed opacity-50"
             }`}
           >
             {currentExecRate < 100 ? `Finaliser les tâches (${tasksDone}/${tasksTotal})` : "Clôturer le Projet"}
           </button>
        </div>
      )}

      {/* MODALE DEPENSE */}
      <Modal open={msModal} onClose={() => setMsModal(false)} title="NOUVEAU JALON">
        <form onSubmit={async e => { e.preventDefault(); if (!newMs.label.trim()) return; await saveMilestones([...(project.milestones ?? []), { label: newMs.label.trim(), dueDate: newMs.dueDate || undefined, ...(money ? { amount: Number(newMs.amount) || 0 } : {}) }]); setMsModal(false); setNewMs({ label: "", dueDate: "", amount: 0 }); }} className="space-y-4">
          <FormField label="Libellé" required><input className={inputCls} value={newMs.label} onChange={e => setNewMs({ ...newMs, label: e.target.value })} required /></FormField>
          <FormField label="Échéance"><input type="date" className={inputCls} value={newMs.dueDate ?? ""} onChange={e => setNewMs({ ...newMs, dueDate: e.target.value })} /></FormField>
          {money && <FormField label="Montant à facturer (FCFA)"><input type="number" min={0} className={inputCls} value={newMs.amount ?? 0} onChange={e => setNewMs({ ...newMs, amount: Number(e.target.value) })} /></FormField>}
          <button type="submit" className={buttonClass("primary", "sm", "w-full")}>Ajouter</button>
        </form>
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Modifier — ${project.name}`} size="lg">
        <ProjectEditForm
          initial={{ ...project, clientId: project.clientId, managerId: project.managerId }}
          showBudget={money}
          onCancel={() => setEditOpen(false)}
          onSave={async (v: ProjectEditValue) => { await patchProject(v as unknown as Record<string, unknown>); setEditOpen(false); }}
        />
      </Modal>

      {/* MODALE TACHE */}
      <Modal open={taskModal} onClose={() => setTaskModal(false)} title="NOUVELLE TÂCHE">
        <form onSubmit={addTask} className="space-y-4">
          <FormField label="Libellé" required>
            <input className={inputCls} value={newTask.label} onChange={e => setNewTask({...newTask, label: e.target.value})} required />
          </FormField>
          <FormField label="Statut initial">
            <select className={selectCls} value={newTask.status} onChange={e => setNewTask({...newTask, status: e.target.value})}>
              <option value="todo">À faire</option>
              <option value="in_progress">En cours</option>
            </select>
          </FormField>
          <button type="submit" className={buttonClass("primary", "sm", "w-full")}>Créer</button>
        </form>
      </Modal>

      {/* MODALE DOCUMENT */}
      <Modal open={docModal} onClose={() => setDocModal(false)} title="UPLOADER UN PDF">
        <form onSubmit={addDocument} className="space-y-4">
          <FormField label="Fichier PDF" required>
            <input type="file" className={inputCls} accept=".pdf" onChange={e => setSelectedFile(e.target.files?.[0] || null)} required />
          </FormField>
          <FormField label="Nom du document">
            <input className={inputCls} value={newDoc.name} onChange={e => setNewDoc({...newDoc, name: e.target.value})} />
          </FormField>
          <FormField label="Catégorie">
            <select className={selectCls} value={newDoc.type} onChange={e => setNewDoc({...newDoc, type: e.target.value})}>
              <option value="rapport">Rapport</option>
              <option value="contrat">Contrat</option>
              <option value="facture">Facture</option>
              <option value="autre">Autre</option>
            </select>
          </FormField>
          <button type="submit" className={buttonClass("primary", "sm", "w-full")}>Envoyer</button>
        </form>
      </Modal>

      {/* MODALE MEMBRE */}
      <Modal open={memberModal} onClose={() => setMemberModal(false)} title="AJOUTER À L'ÉQUIPE">
        <form onSubmit={addMember} className="space-y-4">
          <FormField label="Collaborateur" required>
            <select className={selectCls} value={newMember.userId} onChange={e => setNewMember({...newMember, userId: e.target.value})} required>
              <option value="">-- Sélectionner --</option>
              {bureauMembers.map(m => (
                <option key={m._id} value={m._id}>{m.firstName} {m.lastName}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Rôle assigné">
            <select className={selectCls} value={newMember.role} onChange={e => setNewMember({...newMember, role: e.target.value})}>
              <option value="contributor">Contributeur</option>
              <option value="manager">Gestionnaire</option>
              <option value="lead">Chef de projet</option>
            </select>
          </FormField>
          <button type="submit" className={buttonClass("primary", "sm", "w-full")}>Ajouter au projet</button>
        </form>
      </Modal>
    </div>
  );
}