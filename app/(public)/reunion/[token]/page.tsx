"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarClock, MapPin, Video, User, AlertCircle } from "lucide-react";

interface Meeting {
  title: string; description?: string; type: string;
  startAt: string; endAt?: string; allDay?: boolean;
  location?: string; meetingLink?: string; status?: string;
  organizer?: string | null; orgName?: string | null; orgLogo?: string | null;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export default function PublicMeetingPage() {
  const { token } = useParams();
  const [m, setM] = useState<Meeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/public/reunion/${token}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setM(d.data); else setError(d.error || "Réunion introuvable."); })
      .catch(() => setError("Chargement impossible."))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen grid place-items-center bg-surface2 p-4">
      <div className="w-full max-w-md bg-surface rounded-2xl border border-line shadow-sm overflow-hidden">
        {loading ? (
          <div className="h-64 animate-pulse bg-surface2" />
        ) : error ? (
          <div className="p-8 text-center space-y-2">
            <AlertCircle className="mx-auto text-neg" />
            <p className="text-sm text-ink2">{error}</p>
          </div>
        ) : m ? (
          <>
            <div className="px-6 pt-6 pb-4 border-b border-line">
              <div className="flex items-center gap-2 mb-3">
                {m.orgLogo
                  ? <img src={m.orgLogo} alt="" className="w-8 h-8 rounded object-contain" />
                  : <span className="w-8 h-8 rounded bg-section/10 text-section grid place-items-center"><CalendarClock size={16} /></span>}
                <span className="text-sm font-semibold text-ink2">{m.orgName || "Invitation"}</span>
              </div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-section">Invitation à une réunion</p>
              <h1 className="text-xl font-bold text-ink mt-1">{m.title}</h1>
              {m.status === "cancelled" && <p className="mt-2 text-sm font-semibold text-neg">Cette réunion a été annulée.</p>}
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <CalendarClock size={17} className="text-ink3 mt-0.5 shrink-0" />
                <div>
                  <p className="text-ink capitalize font-medium">{fmtDate(m.startAt)}</p>
                  <p className="text-ink2">{m.allDay ? "Journée entière" : `${fmtTime(m.startAt)}${m.endAt ? ` – ${fmtTime(m.endAt)}` : ""}`}</p>
                </div>
              </div>
              {m.location && (
                <div className="flex items-start gap-3">
                  <MapPin size={17} className="text-ink3 mt-0.5 shrink-0" />
                  <p className="text-ink">{m.location}</p>
                </div>
              )}
              {m.organizer && (
                <div className="flex items-start gap-3">
                  <User size={17} className="text-ink3 mt-0.5 shrink-0" />
                  <p className="text-ink2">Organisé par <span className="text-ink font-medium">{m.organizer}</span></p>
                </div>
              )}
              {m.description && <p className="text-ink2 whitespace-pre-wrap border-t border-line pt-4">{m.description}</p>}
              {m.meetingLink && m.status !== "cancelled" && (
                <a href={m.meetingLink} target="_blank" rel="noopener noreferrer"
                  className="mt-2 w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
                  <Video size={16} /> Rejoindre la réunion
                </a>
              )}
            </div>
          </>
        ) : null}
        <p className="px-6 py-3 text-center text-[11px] text-ink3 border-t border-line">Propulsé par Kanoo</p>
      </div>
    </div>
  );
}
