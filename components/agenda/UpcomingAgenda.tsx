"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Users, MapPin } from "lucide-react";
import { AgendaItem, itemColor, TYPE_META } from "./types";

import { apiJson } from "@/lib/api-client";
function when(it: AgendaItem): string {
  const d = new Date(it.startAt);
  const day = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  if (it.allDay) return `${day} · journée`;
  return `${day} · ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Aperçu « Prochains rendez-vous » pour le tableau de bord. `agendaHref` diffère
 * selon l'espace (/agenda, /associations/agenda, /administration/agenda).
 */
export function UpcomingAgenda({ agendaHref = "/agenda" }: { agendaHref?: string }) {
  const [items, setItems] = useState<AgendaItem[] | null>(null);

  useEffect(() => {
    apiJson("/api/agenda/upcoming?limit=5")
      .then((d) => setItems(d.success ? d.data : []))
      .catch(() => setItems([]));
  }, []);

  return (
    <div className="bg-surface rounded-xl border border-line overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <h2 className="font-semibold text-ink flex items-center gap-2">
          <CalendarClock size={17} /> Prochains rendez-vous
        </h2>
        <Link href={agendaHref} className="text-xs text-section hover:underline">Agenda →</Link>
      </div>

      {items === null ? (
        <div className="p-5 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 bg-surface2 rounded animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-ink3">
          Rien de prévu.{" "}
          <Link href={agendaHref} className="text-section hover:underline">Ajouter au calendrier</Link>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((it) => (
            <li key={it._id}>
              <Link href={agendaHref} className="flex items-start gap-3 px-5 py-3 hover:bg-surface2/40">
                <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: itemColor(it) }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink truncate">{it.title}</span>
                    {it.visibility === "shared" && <Users size={12} className="text-ink3 shrink-0" aria-label="Partagé" />}
                  </span>
                  <span className="text-xs text-ink2 flex items-center gap-2 flex-wrap">
                    <span>{when(it)}</span>
                    <span className="text-ink3">· {TYPE_META[it.type]?.label}</span>
                    {it.location && <span className="inline-flex items-center gap-0.5 text-ink3"><MapPin size={11} />{it.location}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
