"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, ArrowRight } from "lucide-react";

interface Ev { _id: string; title: string; startAt: string; registered: number; capacity: number; }

export function UpcomingEvents() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/events?upcoming=1&limit=5", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setEvents(d.data?.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card card-p">
      <div className="flex items-center justify-between mb-3">
        <h3 className="section-title flex items-center gap-2"><Calendar size={16} className="text-accent-700" /> Prochaines activités</h3>
        <Link href="/activites" className="text-xs font-semibold text-accent-700 hover:underline inline-flex items-center gap-1">
          Tout voir <ArrowRight size={13} />
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 rounded-md bg-surface2 animate-pulse" />)}</div>
      ) : events.length === 0 ? (
        <p className="text-sm text-ink2 py-4 text-center">Aucune activité à venir. <Link href="/activites/new" className="text-accent-700 font-semibold hover:underline">En créer une</Link>.</p>
      ) : (
        <ul className="divide-y divide-line">
          {events.map((e) => (
            <li key={e._id}>
              <Link href={`/activites/${e._id}`} className="flex items-center gap-3 py-2.5 hover:bg-surface2 -mx-2 px-2 rounded-md transition-colors">
                <div className="w-10 h-11 rounded-md bg-accent-50 text-accent-700 grid place-items-center leading-none flex-none">
                  <span className="text-[10px] font-semibold uppercase">{new Date(e.startAt).toLocaleDateString("fr-FR", { month: "short" })}</span>
                  <span className="font-display text-base font-semibold">{new Date(e.startAt).getDate()}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{e.title}</p>
                  <p className="text-xs text-ink2">
                    {new Date(e.startAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    {" · "}<span className="num">{e.registered}</span>{e.capacity > 0 ? ` / ${e.capacity}` : ""} inscrits
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
