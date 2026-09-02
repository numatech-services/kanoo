"use client";
import { useState, useEffect } from "react";
interface Notif { _id:string; type:string; title:string; message:string; read:boolean; createdAt:string; linkedTo?:string; }
export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/notifications",{credentials:"include"}).then(r=>r.json()).then(d=>setNotifs(d.data?.items||[])).finally(()=>setLoading(false)); },[]);
  async function markAllRead() {
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    await fetch("/api/notifications",{method:"PATCH",headers:{"x-csrf-token":csrfToken},credentials:"include"});
    setNotifs(n=>n.map(x=>({...x,read:true})));
  }
  const unread = notifs.filter(n=>!n.read).length;
  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-ink">Notifications</h1><p className="text-sm text-moss mt-0.5">{unread} non lue{unread>1?"s":""}</p></div>
        {unread > 0 && <button onClick={markAllRead} className="px-4 py-2 border border-clay/30 rounded-lg text-sm text-moss hover:bg-sand">Tout marquer comme lu</button>}
      </div>
      {loading ? [...Array(5)].map((_,i)=><div key={i} className="h-16 bg-white rounded-xl border border-clay/20 animate-pulse"/>) :
        notifs.length === 0 ? <div className="text-center py-16"><span className="text-4xl">🔔</span><p className="text-moss mt-3">Aucune notification</p></div> :
        notifs.map(n => (
          <div key={n._id} className={`bg-white rounded-xl border p-4 flex items-start gap-4 ${n.read?"border-clay/20":"border-cedar/30 bg-cedar/5"}`}>
            <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${n.read?"bg-gray-200":"bg-cedar"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink">{n.title}</p>
              <p className="text-xs text-moss mt-0.5">{n.message}</p>
              <p className="text-xs text-moss/60 mt-1">{new Date(n.createdAt).toLocaleString("fr-FR")}</p>
            </div>
          </div>
        ))
      }
    </div>
  );
}
