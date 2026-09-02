"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { MessageComposer } from "@/components/shared/MessageComposer";
import { CheckCircle2, AlertCircle, Banknote, ClipboardList, Plus } from "lucide-react";

// ── Interfaces ────────────────────────────────────────────────────
interface Task { _id: string; label: string; status: string; weight: number; }
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
  tasks: Task[]; documents: ProjectDoc[]; projectMembers: ProjectMember[];
  conversationId?: string;
}

const STATUS_FR: Record<string, string> = {
  planning: "Planification",
  active: "En cours",
  completed: "Terminé",
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminé",
  blocked: "Bloqué"
};

export default function ProjectDetailPage() {
  const { id } = useParams();

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [userId, setUserId] = useState("");
  const [activeTab, setActiveTab] = useState<"tasks" | "docs" | "team" | "messages">("tasks");

  // Modales
  const [taskModal, setTaskModal] = useState(false);
  const [newTask, setNewTask] = useState({ label: "", weight: 1, status: "todo" });
  const [docModal, setDocModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [newDoc, setNewDoc] = useState({ name: "", type: "rapport" });
  const [memberModal, setMemberModal] = useState(false);
  const [bureauMembers, setBureauMembers] = useState<BureauMember[]>([]);
  const [newMember, setNewMember] = useState({ userId: "", role: "contributor" });
  const [budgetModal, setBudgetModal] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState(0);

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
      fetch("/api/bureau", { credentials: "include" })
        .then(r => r.json())
        .then(d => setBureauMembers(d.data?.items || d.data || []));
    }
  }, [memberModal]);

  if (!mounted) return null;
  if (loading || !project) return <div className="p-10 text-moss font-medium italic">Chargement du projet...</div>;

  // --- CALCULS EN TEMPS RÉEL (POUR L'UI ET LA CLÔTURE) ---
  const tasksTotal = project.tasks?.length || 0;
  const tasksDone = project.tasks?.filter(t => {
    const s = t.status?.toLowerCase();
    return s === "done" || s === "completed";
  }).length || 0;
  
  const currentExecRate = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;
  const currentBudgetRate = project.budget > 0 ? Math.round((project.spentAmount / project.budget) * 100) : 0;

  const getCsrf = async () => {
    const res = await fetch("/api/auth/csrf");
    const { csrfToken } = await res.json();
    return csrfToken;
  };

  // --- ACTIONS ---

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    const csrf = await getCsrf();
    const updatedTasks = project.tasks.map(t => t._id === taskId ? { ...t, status: newStatus } : t);
    
    // On calcule le nouveau taux d'exécution pour le sauvegarder
    const newDone = updatedTasks.filter(t => t.status === "done" || t.status === "completed").length;
    const newRate = Math.round((newDone / updatedTasks.length) * 100);

    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ tasks: updatedTasks, executionRate: newRate }),
      credentials: "include"
    });
    fetchData();
  };

  const addExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const csrf = await getCsrf();
    const newSpent = project.spentAmount + Number(expenseAmount);
    const newBudgetRate = Math.round((newSpent / project.budget) * 100);

    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ spentAmount: newSpent, budgetRate: newBudgetRate }),
      credentials: "include"
    });
    setBudgetModal(false);
    setExpenseAmount(0);
    fetchData();
  };

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
    const tasks = [...project.tasks, { ...newTask, _id: `temp-${Date.now()}` }];
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
      <div className="flex justify-between items-end border-b border-clay/10 pb-4">
        <div>
          <Link href="/associations/projets" className="text-xs font-bold text-moss hover:text-cedar transition-colors">← RETOUR AUX PROJETS</Link>
          <h1 className="text-3xl font-bold text-ink mt-2">{project.name}</h1>
          <p className="text-moss font-mono text-xs opacity-70">{project.code}</p>
        </div>
        <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${project.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-sand text-ink'}`}>
          {STATUS_FR[project.status] || project.status}
        </div>
      </div>

      {/* DASHBOARD PROGRESS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-clay/10 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <span className="text-[10px] font-bold uppercase text-moss flex items-center gap-1 italic">
              <ClipboardList size={14} /> Avancement Physique
            </span>
            <span className="font-mono font-bold text-ink">{currentExecRate}%</span>
          </div>
          <div className="h-2 bg-sand rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-all duration-700" style={{ width: `${currentExecRate}%` }} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-clay/10 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <span className="text-[10px] font-bold uppercase text-moss flex items-center gap-1 italic">
              <Banknote size={14} /> Consommation Budget
            </span>
            <span className="font-mono font-bold text-ink">{currentBudgetRate}%</span>
          </div>
          <div className="h-2 bg-sand rounded-full overflow-hidden">
            <div className={`h-full transition-all duration-700 ${currentBudgetRate > 100 ? 'bg-red-500' : 'bg-cedar'}`} style={{ width: `${Math.min(currentBudgetRate, 100)}%` }} />
          </div>
        </div>

        <div className="bg-cedar/5 p-5 rounded-3xl border border-cedar/10 flex flex-col justify-center items-center">
            <p className="text-[10px] font-black text-cedar uppercase mb-1">Dépensé / Total</p>
            <p className="text-lg font-black text-ink">
                {project.spentAmount.toLocaleString()} <span className="text-[10px] opacity-40">/ {project.budget.toLocaleString()} XOF</span>
            </p>
            <button onClick={() => setBudgetModal(true)} className="mt-2 text-[10px] font-bold text-cedar hover:scale-105 transition-transform flex items-center gap-1 bg-white px-3 py-1 rounded-full shadow-sm border border-cedar/10">
               <Plus size={10} /> AJOUTER UNE DÉPENSE
            </button>
        </div>
      </div>

      {/* ALERTES GESTION */}
      {currentBudgetRate > currentExecRate + 15 && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex gap-3 items-center animate-pulse">
          <AlertCircle className="text-red-600" size={20} />
          <p className="text-[11px] text-red-700 font-bold uppercase tracking-tight">
            Alerte : Le budget est consommé plus vite que l'avancement réel du projet.
          </p>
        </div>
      )}

      {/* TABS NAVIGATION */}
      <div className="flex gap-2 bg-sand/30 p-1.5 rounded-2xl w-fit">
        {["tasks", "docs", "team", "messages"].map((t) => (
          <button key={t} onClick={() => setActiveTab(t as any)} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === t ? "bg-white text-cedar shadow-sm" : "text-moss hover:bg-white/50"}`}>
            {t === "tasks" ? "Tâches" : t === "docs" ? "Documents" : t === "team" ? "Équipe" : "Messages"}
          </button>
        ))}
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="bg-white rounded-3xl border border-clay/10 p-8 min-h-[400px] shadow-sm relative">
        {activeTab === "tasks" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black text-ink">LISTE DES TÂCHES</h2>
              <button onClick={() => setTaskModal(true)} className="bg-cedar text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest">+ Ajouter</button>
            </div>
            <div className="divide-y divide-clay/5">
              {project.tasks.map(task => (
                <div key={task._id} className="py-4 flex justify-between items-center group">
                  <div className="flex items-center gap-3">
                    {(task.status === 'done' || task.status === 'completed') ? <CheckCircle2 size={20} className="text-green-500" /> : <div className="w-[20px] h-[20px] border-2 border-clay/20 rounded-full" />}
                    <p className={`text-sm font-bold ${task.status === "done" ? "line-through text-moss opacity-50" : "text-ink"}`}>{task.label}</p>
                  </div>
                  <select 
                    value={task.status} 
                    onChange={(e) => updateTaskStatus(task._id, e.target.value)}
                    className="text-[10px] font-black border-0 bg-sand/40 rounded-lg px-3 py-2 cursor-pointer uppercase hover:bg-sand transition-all outline-none"
                  >
                    <option value="todo">À faire</option>
                    <option value="in_progress">En cours</option>
                    <option value="done">Terminé</option>
                    <option value="blocked">Bloqué</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "team" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black text-ink">ÉQUIPE DU PROJET</h2>
              <button onClick={() => setMemberModal(true)} className="bg-cedar text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest">+ Nouveau</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {project.projectMembers.map((pm) => {
                const person = pm.userId || pm.memberId || pm.bureauMemberId;
                return (
                  <div key={pm._id} className="flex items-center gap-4 p-4 border border-clay/10 rounded-2xl bg-sand/5">
                    <div className="w-10 h-10 bg-cedar/10 text-cedar rounded-full flex items-center justify-center font-black uppercase text-xs">
                      {person?.firstName?.[0] || ""}{person?.lastName?.[0] || ""}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ink">
                        {person?.firstName ? `${person.firstName} ${person.lastName}` : "Utilisateur"}
                      </p>
                      <p className="text-[10px] text-moss font-black uppercase tracking-tighter opacity-70">
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
                <button onClick={() => setDocModal(true)} className="bg-cedar text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest">+ PDF</button>
              </div>
              <div className="grid gap-3">
                {project.documents.map(doc => (
                  <div key={doc._id} className="flex items-center justify-between p-4 bg-sand/10 rounded-2xl border border-clay/5 hover:bg-sand/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">📄</span>
                      <div>
                        <p className="font-bold text-ink text-sm">{doc.name}</p>
                        <p className="text-[10px] text-moss font-black uppercase">{doc.type}</p>
                      </div>
                    </div>
                    {doc.url && (
                      <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-cedar font-black text-[10px] uppercase hover:underline">
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
               ? "bg-green-600 text-white hover:bg-green-700 hover:-translate-y-1 active:translate-y-0" 
               : "bg-clay/10 text-moss cursor-not-allowed opacity-50"
             }`}
           >
             {currentExecRate < 100 ? `Finaliser les tâches (${tasksDone}/${tasksTotal})` : "Clôturer le Projet"}
           </button>
        </div>
      )}

      {/* MODALE DEPENSE */}
      <Modal open={budgetModal} onClose={() => setBudgetModal(false)} title="SAISIR UNE DÉPENSE">
        <form onSubmit={addExpense} className="space-y-4">
          <FormField label="Montant (XOF)" required>
            <input type="number" className={inputCls} value={expenseAmount} onChange={e => setExpenseAmount(Number(e.target.value))} required />
          </FormField>
          <p className="text-[10px] text-moss font-bold uppercase">L'ajout impactera immédiatement le taux de consommation budgétaire.</p>
          <button type="submit" className="w-full bg-cedar text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest">Enregistrer</button>
        </form>
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
          <button type="submit" className="w-full bg-cedar text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest">Créer</button>
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
          <button type="submit" className="w-full bg-cedar text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest">Envoyer</button>
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
          <button type="submit" className="w-full bg-cedar text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest">Ajouter au projet</button>
        </form>
      </Modal>
    </div>
  );
}