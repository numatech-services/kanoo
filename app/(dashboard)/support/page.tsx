"use client";
import { useState, useEffect } from "react";
interface Ticket { _id:string; subject:string; message:string; priority:string; status:string; createdAt:string; }
export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({subject:"",message:"",priority:"medium"});
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  useEffect(()=>{ fetch("/api/support/tickets",{credentials:"include"}).then(r=>r.json()).then(d=>setTickets(d.data?.items||[])).finally(()=>setLoading(false)); },[]);
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setCreating(true);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/support/tickets",{method:"POST",headers:{"Content-Type":"application/json","x-csrf-token":csrfToken},credentials:"include",body:JSON.stringify(form)});
    const d = await res.json();
    if(res.ok){ setTickets(t=>[d.data,...t]); setShowForm(false); setForm({subject:"",message:"",priority:"medium"}); }
    setCreating(false);
  }
  const inp = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const PRIO:Record<string,string> = {low:"bg-gray-100 text-gray-600",medium:"bg-blue-100 text-blue-700",high:"bg-amber-100 text-amber-700",critical:"bg-red-100 text-red-700"};
  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Support</h1>
        <button onClick={()=>setShowForm(!showForm)} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Nouveau ticket</button>
      </div>
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-clay/20 p-5 space-y-4">
          <div><label className="block text-xs font-medium text-moss mb-1">Sujet *</label><input className={inp} value={form.subject} onChange={e=>setForm(p=>({...p,subject:e.target.value}))} required /></div>
          <div><label className="block text-xs font-medium text-moss mb-1">Priorité</label><select className={inp} value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value}))}><option value="low">Faible</option><option value="medium">Moyenne</option><option value="high">Haute</option><option value="critical">Critique</option></select></div>
          <div><label className="block text-xs font-medium text-moss mb-1">Description *</label><textarea className={inp} rows={4} value={form.message} onChange={e=>setForm(p=>({...p,message:e.target.value}))} required /></div>
          <div className="flex justify-end gap-3"><button type="button" onClick={()=>setShowForm(false)} className="px-4 py-2 text-sm border border-clay/30 rounded-lg text-moss">Annuler</button><button type="submit" disabled={creating} className="px-5 py-2 bg-cedar text-white rounded-lg text-sm font-medium disabled:opacity-60">{creating?"Envoi…":"Envoyer"}</button></div>
        </form>
      )}
      {loading ? <div className="h-24 bg-sand animate-pulse rounded-xl"/> :
        tickets.length === 0 ? <div className="text-center py-12 text-moss">Aucun ticket ouvert</div> :
        tickets.map(t => (
          <div key={t._id} className="bg-white rounded-xl border border-clay/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-ink text-sm">{t.subject}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${PRIO[t.priority]||""}`}>{t.priority}</span>
            </div>
            <p className="text-xs text-moss mt-1 line-clamp-2">{t.message}</p>
            <div className="flex items-center justify-between mt-3"><span className={`text-xs px-2 py-0.5 rounded-full ${t.status==="open"?"bg-green-100 text-green-700":"bg-gray-100 text-gray-500"}`}>{t.status}</span><span className="text-xs text-moss">{new Date(t.createdAt).toLocaleDateString("fr-FR")}</span></div>
          </div>
        ))
      }
    </div>
  );
}
