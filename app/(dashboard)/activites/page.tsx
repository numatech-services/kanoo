"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Calendar, MapPin, Video, Users, Plus, Ticket } from "lucide-react";
import toast from "react-hot-toast";

interface Ev {
  _id: string;
  title: string;
  startAt: string;
  endAt?: string;
  locationType: string;
  address?: string;
  capacity: number;
  status: string;
  isPaid: boolean;
  registered: number;
  present: number;
  category?: string;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Brouillon", cls: "badge-draft" },
  published: { label: "Publié", cls: "badge-sent" },
  cancelled: { label: "Annulé", cls: "badge-late" },
  completed: { label: "Terminé", cls: "badge-paid" },
};

const FILTERS = [
  { key: "", label: "Toutes" },
  { key: "published", label: "Publiées" },
  { key: "draft", label: "Brouillons" },
  { key: "completed", label: "Terminées" },
];

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export default function ActivitesPage() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events${filter ? `?status=${filter}` : ""}`, { credentials: "include" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur de chargement");
      setEvents(d.data?.items || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Activités</h1>
          <p className="text-sm text-ink2 mt-0.5">Événements, réunions et billetterie de votre organisation.</p>
        </div>
        <Link href="/activites/new" className="btn-primary">
          <Plus size={16} /> Nouvelle activité
        </Link>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-sm font-medium px-3 h-9 rounded-md border transition-colors ${
              filter === f.key ? "bg-ink text-bg border-ink" : "bg-surface text-ink2 border-line2 hover:bg-surface2"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-44 rounded-lg border border-line bg-surface animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-line2 rounded-lg bg-surface">
          <Calendar size={34} className="mx-auto text-ink3" />
          <p className="mt-3 font-display text-lg text-ink">Aucune activité pour le moment</p>
          <p className="text-sm text-ink2 mt-1">Créez votre première activité pour gérer inscriptions, billets et présences.</p>
          <Link href="/activites/new" className="btn-primary mt-4 inline-flex"><Plus size={16} /> Créer une activité</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((e) => {
            const st = STATUS[e.status] || STATUS.draft;
            const pct = e.capacity > 0 ? Math.min(100, Math.round((e.registered / e.capacity) * 100)) : 0;
            return (
              <Link
                key={e._id}
                href={`/activites/${e._id}`}
                className="group rounded-lg border border-line bg-surface shadow-sm hover:shadow-soft transition-shadow overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-11 h-12 rounded-md bg-accent-50 text-accent-700 grid place-items-center leading-none">
                        <span className="text-[10px] font-semibold uppercase">{new Date(e.startAt).toLocaleDateString("fr-FR", { month: "short" })}</span>
                        <span className="font-display text-lg font-semibold">{new Date(e.startAt).getDate()}</span>
                      </div>
                      <div>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                        {e.isPaid && <span className="badge badge-warn ml-1"><Ticket size={11} /> Payant</span>}
                      </div>
                    </div>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-ink mt-3 leading-snug line-clamp-2 group-hover:text-accent-700 transition-colors">
                    {e.title}
                  </h3>
                  <div className="mt-2 space-y-1.5 text-sm text-ink2">
                    <div className="flex items-center gap-2">
                      <Calendar size={14} className="text-ink3" /> {fmtDate(e.startAt)} · {fmtTime(e.startAt)}
                    </div>
                    <div className="flex items-center gap-2">
                      {e.locationType === "online" ? <Video size={14} className="text-ink3" /> : <MapPin size={14} className="text-ink3" />}
                      <span className="truncate">{e.locationType === "online" ? "En ligne" : e.address || "Lieu à préciser"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-ink3" />
                      <span className="num">{e.registered}</span>{e.capacity > 0 ? <span className="text-ink3">/ {e.capacity} inscrits</span> : <span className="text-ink3">inscrits</span>}
                    </div>
                  </div>
                  {e.capacity > 0 && (
                    <div className="mt-3 h-1.5 rounded-full bg-surface2 overflow-hidden">
                      <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
