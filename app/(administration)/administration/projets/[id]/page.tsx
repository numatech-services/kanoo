"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { MessageComposer } from "@/components/shared/MessageComposer";

interface Task { _id:string; label:string; status:string; assigneeId?:{firstName:string;lastName:string}; dueDate?:string; weight:number; }
interface Milestone { _id:string; label:string; dueDate?:string; completedAt?:string; amount:number; }
interface ProjectDoc { _id:string; name:string; type:string; uploadedAt:string; url?:string; }
interface ProjectMember { _id:string; userId?:{firstName:string;lastName:string;role:string}; memberId?:{firstName:string;lastName:string;code:string}; bureauMemberId?:{firstName:string;lastName:string;role:string}; role:string; }
interface Project {
  _id:string; code:string; name:string; description?:string; status:string; projectType:string;
  budget:number; spentAmount:number; budgetRate:number; executionRate:number; daysProgress:number;
  startDate?:string; endDate?:string; bailleurName?:string;
  tasks:Task[]; milestones:Milestone[]; documents:ProjectDoc[]; projectMembers:ProjectMember[];
  conversationId?:string;
}

const STATUS_COLORS: Record<string,string> = {
  planning:"bg-gray-100 text-gray-600", active:"bg-blue-100 text-blue-700",
  on_hold:"bg-amber-100 text-amber-700", completed:"bg-green-100 text-green-700", cancelled:"bg-red-100 text-red-700"
};
const STATUS_FR: Record<string,string> = { planning:"Planification", active:"En cours", on_hold:"En pause", completed:"Terminé", cancelled:"Annulé" };

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [project, setProject] = useState<Project|null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"tasks"|"milestones"|"docs"|"team"|"messages">("tasks");
  const [taskModal, setTaskModal] = useState(false);
  const [newTask, setNewTask] = useState({ label:"", weight:1, status:"todo" });
  const [userId, setUserId] = useState("");

  useEffect(() => {
    fetch("/api/auth/me",{credentials:"include"}).then(r=>r.json()).then(d=>setUserId(d.data?.user?._id||""));
    fetch(`/api/projects/${id}`,{credentials:"include"}).then(r=>r.json()).then(d=>setProject(d.data)).finally(()=>setLoading(false));
  }, [id]);

  async function updateTaskStatus(taskId: string, status: string) {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const updated = { ...project!, tasks: project!.tasks.map(t => t._id === taskId ? { ...t, status } : t) };
    await fetch(`/api/projects/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json","x-csrf-token":csrfToken}, credentials:"include", body:JSON.stringify({ tasks: updated.tasks }) });
    setProject(updated);
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const tasks = [...(project?.tasks || []), { ...newTask, _id: Date.now().toString() }];
    await fetch(`/api/projects/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json","x-csrf-token":csrfToken}, credentials:"include", body:JSON.stringify({ tasks }) });
    const res = await fetch(`/api/projects/${id}`,{credentials:"include"}); const d = await res.json(); setProject(d.data);
    setTaskModal(false); setNewTask({ label:"", weight:1, status:"todo" });
  }

  if (loading) return <div className="p-6"><div className="h-64 bg-white rounded-xl animate-pulse border border-clay/20"/></div>;
  if (!project) return <div className="p-6 text-moss">Projet introuvable</div>;

  const tasksDone = project.tasks.filter(t => t.status === "done").length;
  const tasksTotal = project.tasks.length;

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/administration/projets" className="text-xs text-moss hover:text-ink">← Projets publics</Link>
          <h1 className="text-2xl font-bold text-ink mt-1">{project.name}</h1>
          <p className="text-moss text-sm font-mono">{project.code}{project.bailleurName && ` · Bailleur : ${project.bailleurName}`}</p>
        </div>
        <span className={`text-sm font-medium px-3 py-1.5 rounded-full mt-2 ${STATUS_COLORS[project.status]||""}`}>{STATUS_FR[project.status]||project.status}</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Taux d'exécution */}
        <div className="bg-white rounded-xl border border-clay/20 p-4">
          <p className="text-xs text-moss mb-2">Taux d'exécution</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-sand rounded-full"><div className="h-2 rounded-full bg-green-500 transition-all" style={{ width:`${project.executionRate}%` }}/></div>
            <span className={`text-sm font-bold font-mono ${project.executionRate>=80?"text-green-700":project.executionRate>=40?"text-amber-600":"text-red-500"}`}>{project.executionRate}%</span>
          </div>
          <p className="text-xs text-moss mt-1">{tasksDone}/{tasksTotal} tâches</p>
        </div>
        {/* Budget */}
        <div className="bg-white rounded-xl border border-clay/20 p-4">
          <p className="text-xs text-moss mb-1">Budget consommé</p>
          <p className={`text-xl font-bold font-mono ${project.budgetRate>100?"text-red-600":project.budgetRate>80?"text-amber-600":"text-green-700"}`}>{project.budgetRate}%</p>
          <p className="text-xs text-moss">{project.spentAmount.toLocaleString("fr-FR")} / {project.budget.toLocaleString("fr-FR")} XOF</p>
        </div>
        {/* Jalons */}
        <div className="bg-white rounded-xl border border-clay/20 p-4">
          <p className="text-xs text-moss mb-1">Jalons</p>
          <p className="text-xl font-bold text-ink">{project.milestones.filter(m => m.completedAt).length} / {project.milestones.length}</p>
          <p className="text-xs text-moss">jalons atteints</p>
        </div>
        {/* Dates */}
        <div className="bg-white rounded-xl border border-clay/20 p-4">
          <p className="text-xs text-moss mb-1">Période</p>
          <p className="text-sm font-medium text-ink">{project.startDate ? new Date(project.startDate).toLocaleDateString("fr-FR") : "—"}</p>
          <p className="text-xs text-moss">→ {project.endDate ? new Date(project.endDate).toLocaleDateString("fr-FR") : "Illimitée"}</p>
        </div>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 bg-sand p-1 rounded-xl w-fit">
        {(["tasks","milestones","docs","team","messages"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${activeTab===tab?"bg-white text-ink font-medium":"text-moss hover:text-ink"}`}>
            {{ tasks:`Tâches (${tasksTotal})`, milestones:`Jalons (${project.milestones.length})`, docs:`Documents (${project.documents.length})`, team:`Équipe (${project.projectMembers.length})`, messages:"Messages" }[tab]}
          </button>
        ))}
      </div>

      {/* Contenu onglets */}
      {activeTab === "tasks" && (
        <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
          <div className="flex justify-between items-center px-5 py-3 border-b border-clay/10">
            <p className="font-semibold text-ink text-sm">Tâches</p>
            <button onClick={() => setTaskModal(true)} className="text-xs text-cedar hover:underline">+ Ajouter</button>
          </div>
          <div className="divide-y divide-clay/10">
            {project.tasks.length === 0 && <p className="text-moss text-sm text-center py-8">Aucune tâche — ajoutez-en une</p>}
            {project.tasks.map(task => (
              <div key={task._id} className="flex items-center gap-4 px-5 py-3">
                <select value={task.status} onChange={e => updateTaskStatus(task._id, e.target.value)}
                  className={`text-xs rounded-full px-2 py-0.5 font-medium border-0 cursor-pointer ${task.status==="done"?"bg-green-100 text-green-700":task.status==="in_progress"?"bg-blue-100 text-blue-700":task.status==="blocked"?"bg-red-100 text-red-600":"bg-gray-100 text-gray-600"}`}>
                  <option value="todo">À faire</option>
                  <option value="in_progress">En cours</option>
                  <option value="done">Terminé</option>
                  <option value="blocked">Bloqué</option>
                </select>
                <p className={`flex-1 text-sm ${task.status==="done"?"line-through text-moss":"text-ink"}`}>{task.label}</p>
                {task.dueDate && <span className="text-xs text-moss">{new Date(task.dueDate).toLocaleDateString("fr-FR")}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "milestones" && (
        <div className="space-y-3">
          {project.milestones.length === 0 && <div className="bg-white rounded-xl border border-clay/20 p-8 text-center text-moss text-sm">Aucun jalon défini</div>}
          {project.milestones.map(m => (
            <div key={m._id} className={`bg-white rounded-xl border p-4 flex items-start justify-between ${m.completedAt?"border-green-200":"border-clay/20"}`}>
              <div>
                <p className="font-medium text-ink text-sm">{m.label}</p>
                {m.dueDate && <p className="text-xs text-moss mt-0.5">Échéance : {new Date(m.dueDate).toLocaleDateString("fr-FR")}</p>}
                {m.amount > 0 && <p className="text-xs text-moss">Montant : {m.amount.toLocaleString("fr-FR")} XOF</p>}
              </div>
              {m.completedAt
                ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ Atteint le {new Date(m.completedAt).toLocaleDateString("fr-FR")}</span>
                : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">En attente</span>
              }
            </div>
          ))}
        </div>
      )}

      {activeTab === "docs" && (
        <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
          <div className="flex justify-between items-center px-5 py-3 border-b border-clay/10">
            <p className="font-semibold text-ink text-sm">Documents ({project.documents.length})</p>
            <button className="text-xs text-cedar hover:underline">+ Joindre un document</button>
          </div>
          {project.documents.length === 0
            ? <p className="text-moss text-sm text-center py-8">Aucun document joint</p>
            : project.documents.map(doc => (
              <div key={doc._id} className="flex items-center justify-between px-5 py-3 border-b border-clay/10 last:border-0">
                <div className="flex items-center gap-3"><span className="text-lg">📎</span><div><p className="text-sm font-medium text-ink">{doc.name}</p><p className="text-xs text-moss capitalize">{doc.type} · {new Date(doc.uploadedAt).toLocaleDateString("fr-FR")}</p></div></div>
                {doc.url && <a href={doc.url} target="_blank" className="text-xs text-cedar hover:underline">Télécharger</a>}
              </div>
            ))
          }
        </div>
      )}

      {activeTab === "team" && (
        <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
          <div className="flex justify-between items-center px-5 py-3 border-b border-clay/10">
            <p className="font-semibold text-ink text-sm">Équipe projet ({project.projectMembers.length})</p>
            <button className="text-xs text-cedar hover:underline">+ Ajouter un membre</button>
          </div>
          {project.projectMembers.length === 0
            ? <p className="text-moss text-sm text-center py-8">Aucun agent assigné au projet</p>
            : project.projectMembers.map(pm => {
              const person = pm.userId || pm.memberId || pm.bureauMemberId;
              const name = person ? `${(person as {firstName:string}).firstName} ${(person as {lastName:string}).lastName}` : "—";
              return (
                <div key={pm._id} className="flex items-center gap-3 px-5 py-3 border-b border-clay/10 last:border-0">
                  <div className="w-8 h-8 bg-cedar/10 text-cedar rounded-full flex items-center justify-center text-xs font-medium">{name.slice(0,2).toUpperCase()}</div>
                  <div className="flex-1"><p className="text-sm font-medium text-ink">{name}</p><p className="text-xs text-moss">{pm.role || "Membre"}</p></div>
                </div>
              );
            })
          }
        </div>
      )}

      {activeTab === "messages" && userId && (
        <div className="bg-white rounded-xl border border-clay/20 overflow-hidden" style={{ height: "450px" }}>
          <MessageComposer currentUserId={userId} conversationId={project.conversationId} compact />
        </div>
      )}

      <Modal open={taskModal} onClose={() => setTaskModal(false)} title="Ajouter une tâche" size="sm">
        <form onSubmit={addTask} className="space-y-4">
          <FormField label="Libellé de la tâche" required><input className={inputCls} value={newTask.label} onChange={e=>setNewTask(p=>({...p,label:e.target.value}))} required/></FormField>
          <FormField label="Statut initial"><select className={selectCls} value={newTask.status} onChange={e=>setNewTask(p=>({...p,status:e.target.value}))}><option value="todo">À faire</option><option value="in_progress">En cours</option></select></FormField>
          <FormField label="Poids (pour calcul %)" hint="1 = tâche normale, 2 = tâche importante"><input type="number" className={inputCls} value={newTask.weight} onChange={e=>setNewTask(p=>({...p,weight:Number(e.target.value)}))} min={1} max={10}/></FormField>
          <div className="flex justify-end gap-3 pt-2 border-t border-clay/20">
            <button type="button" onClick={()=>setTaskModal(false)} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
            <button type="submit" className="px-5 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink">Ajouter</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
