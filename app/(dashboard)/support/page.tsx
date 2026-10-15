"use client";
import { useState, useEffect } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
interface Ticket { _id:string; subject:string; message:string; priority:string; status:string; createdAt:string; }
export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({subject:"",message:"",priority:"medium"});
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  useEffect(()=>{ apiJson("/api/support/tickets").then(d=>setTickets(d.data?.items||[])).finally(()=>setLoading(false)); },[]);
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setCreating(true);
    const res = await apiSend("POST", "/api/support/tickets", form);
    const d = res.data;
    if(res.ok){ setTickets(t=>[d.data,...t]); setShowForm(false); setForm({subject:"",message:"",priority:"medium"}); }
    setCreating(false);
  }
  const inp = "w-full px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30";
  const PRIO:Record<string,string> = {low:"bg-surface2 text-ink2",medium:"bg-info-50 text-info",high:"bg-warn-50 text-warn",critical:"bg-neg-50 text-neg"};
  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Support</h1>
        <button onClick={()=>setShowForm(!showForm)} className={buttonClass("primary", "md")}>+ Nouveau ticket</button>
      </div>
      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface rounded-xl border border-line p-5 space-y-4">
          <div><label className="block text-xs font-medium text-ink2 mb-1">Sujet *</label><input className={inp} value={form.subject} onChange={e=>setForm(p=>({...p,subject:e.target.value}))} required /></div>
          <div><label className="block text-xs font-medium text-ink2 mb-1">Priorité</label><select className={inp} value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value}))}><option value="low">Faible</option><option value="medium">Moyenne</option><option value="high">Haute</option><option value="critical">Critique</option></select></div>
          <div><label className="block text-xs font-medium text-ink2 mb-1">Description *</label><textarea className={inp} rows={4} value={form.message} onChange={e=>setForm(p=>({...p,message:e.target.value}))} required /></div>
          <div className="flex justify-end gap-3"><button type="button" onClick={()=>setShowForm(false)} className="px-4 py-2 text-sm border border-line rounded-lg text-ink2">Annuler</button><button type="submit" disabled={creating} className={buttonClass("primary", "md")}>{creating?"Envoi…":"Envoyer"}</button></div>
        </form>
      )}
      {loading ? <div className="h-24 bg-surface2 animate-pulse rounded-xl"/> :
        tickets.length === 0 ? <div className="text-center py-12 text-ink2">Aucun ticket ouvert</div> :
        tickets.map(t => (
          <div key={t._id} className="bg-surface rounded-xl border border-line p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-ink text-sm">{t.subject}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${PRIO[t.priority]||""}`}>{t.priority}</span>
            </div>
            <p className="text-xs text-ink2 mt-1 line-clamp-2">{t.message}</p>
            <div className="flex items-center justify-between mt-3"><StatusBadge status={t.status} /><span className="text-xs text-ink2">{new Date(t.createdAt).toLocaleDateString("fr-FR")}</span></div>
          </div>
        ))
      }
    </div>
  );
}
