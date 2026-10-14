"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { notificationHref } from "@/lib/notification-link";
import { Bell } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
interface Notif { _id:string; type:string; title:string; message:string; read:boolean; createdAt:string; linkedTo?:string; linkedId?:string|null; }
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
        <div><h1 className="page-title">Notifications</h1><p className="text-sm text-ink2 mt-0.5">{unread} non lue{unread>1?"s":""}</p></div>
        {unread > 0 && <button onClick={markAllRead} className={buttonClass("secondary", "md")}>Tout marquer comme lu</button>}
      </div>
      {loading ? [...Array(5)].map((_,i)=><div key={i} className="h-16 bg-surface rounded-xl border border-line animate-pulse"/>) :
        notifs.length === 0 ? <div className="text-center py-16"><span className="text-ink3 inline-flex" aria-hidden><Bell size={36} /></span><p className="text-ink2 mt-3">Aucune notification</p></div> :
        notifs.map(n => (
          <div key={n._id} className={`bg-surface rounded-xl border p-4 flex items-start gap-4 ${n.read?"border-line":"border-section/30 bg-section/5"}`}>
            <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${n.read?"bg-line":"bg-section"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink">{n.title}</p>
              <p className="text-xs text-ink2 mt-0.5">{n.message}</p>
              <p className="text-xs text-ink2/60 mt-1">{new Date(n.createdAt).toLocaleString("fr-FR")}</p>
            </div>
            {notificationHref(n) && (
              <Link href={notificationHref(n)!} className="shrink-0 self-center px-3 h-8 inline-flex items-center rounded-lg border border-line2 text-xs font-semibold text-section hover:bg-surface2">
                Ouvrir
              </Link>
            )}
          </div>
        ))
      }
    </div>
  );
}
