"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Plus, Users, MapPin, Video, Trash2, CalendarDays, ChevronLeft, ChevronRight, Link2, Copy, Check, AlertTriangle, Download } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls, selectCls } from "@/components/ui/FormField";
import { AgendaItem, AgendaType, TYPE_META, ownerName, calendarColor, SUGGESTED_CALENDARS } from "./types";
import { MonthGrid, EventChip, localDayKey } from "./CalendarGrid";

import { confirmDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken, apiJson, api, apiErrorMessage, apiSend } from "@/lib/api-client";
import { showToast } from "@/components/ui/Toast";
import { useApi } from "@/lib/use-api";
import { useMe } from "@/lib/useMe";
async function csrf() {
  const csrfToken = await getCsrfToken();
  return csrfToken as string;
}

type Scope = "all" | "mine" | "shared";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "mine", label: "Mon agenda" },
  { key: "shared", label: "Partagés" },
];

type View = "list" | "week" | "month" | "quarter" | "semester" | "year";
const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "Liste" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
  { key: "quarter", label: "Trimestre" },
  { key: "semester", label: "Semestre" },
  { key: "year", label: "Année" },
];

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
/** « 09 h », « 09 h 45 » : les horaires du panneau du jour. */
const hHour = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")} h${d.getMinutes() ? ` ${String(d.getMinutes()).padStart(2, "0")}` : ""}`;
};

/** Pour un <input type="datetime-local"> : ISO local sans secondes ni fuseau. */
function toLocalInput(iso?: string | Date): string {
  const d = iso ? new Date(iso) : new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

const mondayOf = (d: Date) => { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };

/** Fenêtre de dates + mois à afficher, selon la vue et la date d'ancrage. */
function period(view: View, anchor: Date): { from: Date; to: Date; months: { y: number; m: number }[]; label: string } {
  const y = anchor.getFullYear(), m = anchor.getMonth();
  if (view === "week") {
    const from = mondayOf(anchor), to = new Date(from); to.setDate(to.getDate() + 7);
    const last = new Date(to); last.setDate(last.getDate() - 1);
    const label = `${from.toLocaleDateString("fr-FR", { day: "numeric", month: from.getMonth() === last.getMonth() ? undefined : "short" })} – ${last.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
    return { from, to, months: [], label };
  }
  if (view === "month") {
    return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1), months: [{ y, m }],
      label: anchor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) };
  }
  if (view === "quarter") {
    const qs = Math.floor(m / 3) * 3;
    const months = [0, 1, 2].map((i) => ({ y: y + Math.floor((qs + i) / 12), m: (qs + i) % 12 }));
    return { from: new Date(y, qs, 1), to: new Date(y, qs + 3, 1), months, label: `T${Math.floor(qs / 3) + 1} ${y}` };
  }
  if (view === "semester") {
    const hs = m < 6 ? 0 : 6;
    const months = Array.from({ length: 6 }, (_, i) => ({ y, m: hs + i }));
    return { from: new Date(y, hs, 1), to: new Date(y, hs + 6, 1), months, label: `${hs === 0 ? "1er" : "2ᵉ"} semestre ${y}` };
  }
  if (view === "list") {
    const from = new Date(); from.setHours(0, 0, 0, 0); const to = new Date(from); to.setDate(to.getDate() + 90);
    return { from, to, months: [], label: "90 prochains jours" };
  }
  const months = Array.from({ length: 12 }, (_, i) => ({ y, m: i }));
  return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), months, label: `${y}` };
}

function shift(view: View, anchor: Date, dir: 1 | -1): Date {
  const d = new Date(anchor);
  if (view === "week") d.setDate(d.getDate() + 7 * dir);
  else if (view === "month") d.setMonth(d.getMonth() + dir);
  else if (view === "quarter") d.setMonth(d.getMonth() + 3 * dir);
  else if (view === "semester") d.setMonth(d.getMonth() + 6 * dir);
  else d.setFullYear(d.getFullYear() + dir);
  return d;
}

const NO_ITEMS: AgendaItem[] = [];
const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id?: string })._id ?? "") : v ? String(v) : "");

const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia("(max-width: 639px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** Deux rendez-vous horaires qui se recouvrent pour une même personne (organisateur ou participant). */
function findConflict(items: AgendaItem[], meId: string): { who: string; a: AgendaItem; b: AgendaItem } | null {
  const timed = items.filter(i => !i.allDay && !i.virtual && i.status !== "cancelled")
    // Sans heure de fin : une heure par défaut (sinon seuls deux rendez-vous à la même minute se « chevauchaient »).
    .map(i => { const s = new Date(i.startAt).getTime(); return { i, s, e: i.endAt ? new Date(i.endAt).getTime() : s + 3_600_000 }; })
    .sort((x, y) => x.s - y.s);
  const people = (i: AgendaItem) => {
    const list: Array<{ id: string; name: string }> = [];
    if (i.ownerId) list.push({ id: idOf(i.ownerId), name: ownerName(i.ownerId) });
    for (const p of i.participants ?? []) list.push({ id: idOf(p), name: [p.firstName, p.lastName].filter(Boolean).join(" ") });
    return list.filter(p => p.id);
  };
  for (let x = 0; x < timed.length; x++) for (let y = x + 1; y < timed.length; y++) {
    const A = timed[x], B = timed[y];
    if (B.s >= Math.max(A.e, A.s + 1)) break;
    const shared = people(A.i).find(p => people(B.i).some(q => q.id === p.id));
    if (shared) return { who: shared.id === meId ? "Vous avez" : `${shared.name || "Un participant"} a`, a: A.i, b: B.i };
  }
  return null;
}

export function AgendaView() {
  const router = useRouter();
  const me = useMe();
  const meId = me.user?._id ?? "";
  const [scope, setScope] = useState<Scope>("all");
  // Téléphone : la liste d'abord (sept colonnes de 46 px ne se lisent pas).
  // Lu sans écart d'hydratation : faux au rendu serveur, vrai ensuite sur téléphone.
  const isPhone = useSyncExternalStore(subscribePhone, () => window.matchMedia("(max-width: 639px)").matches, () => false);
  const [chosenView, setView] = useState<View | null>(null);
  const view: View = chosenView ?? (isPhone ? "list" : "month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<string>(() => localDayKey(new Date()));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Partial<AgendaItem> | null>(null);

  const p = period(view, anchor);
  const q = (from: Date, to: Date) => new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), scope: "all", virtual: "1" }).toString();
  const fromMs = p.from.getTime(), toMs = p.to.getTime();
  const url = useMemo(() => `/api/agenda?${q(new Date(fromMs), new Date(toMs))}`, [fromMs, toMs]);
  const { data: items, loading, reload } = useApi<AgendaItem[]>(url, (d) => (d.success ? d.data : []), NO_ITEMS);
  // Semaine en cours (accueil et panneau du jour), quelle que soit la période affichée.
  const [weekUrl] = useState(() => { const f = mondayOf(new Date()); const t = new Date(f); t.setDate(t.getDate() + 7); return `/api/agenda?${q(f, t)}`; });
  const week = useApi<AgendaItem[]>(weekUrl, (d) => (d.success ? d.data : []), NO_ITEMS);
  // Jour choisi hors de la semaine en cours : lu à part.
  const selDate = new Date(`${selected}T00:00:00`);
  const inWeek = selDate >= mondayOf(new Date()) && selDate < new Date(mondayOf(new Date()).getTime() + 7 * 86_400_000);
  const dayUrl = useMemo(() => { const t = new Date(selDate); t.setDate(t.getDate() + 1); return inWeek ? null : `/api/agenda?${q(selDate, t)}`; }, [selected, inWeek]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayApi = useApi<AgendaItem[]>(dayUrl, (d) => (d.success ? d.data : []), NO_ITEMS);
  const load = () => { reload(); week.reload(); dayApi.reload(); };

  const isMine = (it: AgendaItem) => !it.virtual && (idOf(it.ownerId) === meId || (it.participants ?? []).some(x => idOf(x) === meId));
  const calendarOf = (it: AgendaItem) => (it.virtual || it.calendar ? it.calendar || "Partagés" : isMine(it) ? "Mon agenda" : "Partagés");
  const colorOf = (it: AgendaItem) => it.color || calendarColor(calendarOf(it));
  const inScope = (it: AgendaItem, s: Scope) => (s === "all" ? true : s === "mine" ? isMine(it) : it.visibility === "shared" && !it.virtual);
  const visible = items.filter(it => inScope(it, scope) && !hidden.has(calendarOf(it)));

  // Regroupement par jour (heure locale).
  const byDay: Record<string, AgendaItem[]> = {};
  for (const it of visible) (byDay[localDayKey(new Date(it.startAt))] ||= []).push(it);
  const days = Object.keys(byDay).sort();

  // Agendas présents sur la période (cases à cocher), toujours avec « Mon agenda ».
  const calendars = new Map<string, number>([["Mon agenda", 0]]);
  for (const it of items.filter(it => inScope(it, scope))) calendars.set(calendarOf(it), (calendars.get(calendarOf(it)) ?? 0) + 1);
  const counts = Object.fromEntries(SCOPES.map(s => [s.key, items.filter(it => inScope(it, s.key) && !hidden.has(calendarOf(it))).length])) as Record<Scope, number>;

  // Accueil : aujourd'hui et cette semaine (entrées saisies, hors jours fériés).
  const todayKey = localDayKey(new Date());
  // Accueil : entrées non annulées, visibles (agendas cochés), hors jours fériés.
  const weekReal = week.data.filter(it => it.status !== "cancelled" && !hidden.has(calendarOf(it)) && it.calendar !== "Jours fériés");
  const todayCount = weekReal.filter(it => localDayKey(new Date(it.startAt)) === todayKey).length;
  const dayItems = (inWeek ? week.data : dayApi.data).filter(it => localDayKey(new Date(it.startAt)) === selected && !hidden.has(calendarOf(it)))
    .sort((a, b) => (a.allDay === b.allDay ? a.startAt.localeCompare(b.startAt) : a.allDay ? -1 : 1));
  const [now] = useState(() => Date.now()); // instant de l'ouverture : « prochain » rendez-vous
  const nextUp = dayItems.find(it => !it.allDay && new Date(it.startAt).getTime() >= now);
  const conflict = findConflict(dayItems, meId);
  const firstName = me.user?.firstName;

  function newOn(d: Date) {
    const s = new Date(d); s.setHours(9, 0, 0, 0);
    setEditing({ type: "reunion", visibility: "personal", startAt: s.toISOString() });
  }
  function open(it: AgendaItem) {
    if (it.virtual) { if (it.href) router.push(it.href); return; }
    setEditing(it);
  }
  const toggle = (name: string) => setHidden(h => { const n = new Set(h); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  const cols = view === "quarter" ? "lg:grid-cols-3" : view === "semester" ? "md:grid-cols-2 lg:grid-cols-3" : view === "year" ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "";
  const weekDays = view === "week" ? Array.from({ length: 7 }, (_, i) => new Date(p.from.getFullYear(), p.from.getMonth(), p.from.getDate() + i)) : [];
  const selLabel = selected === todayKey ? "Aujourd'hui" : selDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-ink3">Pilotage</p>
          <h1 className="text-[30px] font-extrabold tracking-[-0.03em] text-ink mt-1">Agenda</h1>
          <p className="text-sm text-ink2 mt-1">
            Bonjour{firstName ? ` ${firstName}` : ""}, vous avez <strong className="text-ink">{todayCount}</strong> événement{todayCount > 1 ? "s" : ""} aujourd&apos;hui et <strong className="text-ink">{weekReal.length}</strong> cette semaine.
          </p>
        </div>
        <button onClick={() => newOn(new Date(`${selected}T00:00:00`))}
          className="h-11 px-5 rounded-full grad-brand grad-brand-glow text-sm font-semibold inline-flex items-center gap-2 hover:brightness-105">
          <Plus size={17} /> Nouvel événement
        </button>
      </div>

      {/* Vue + navigation de période */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-2xl bg-surface border border-line gap-0.5 flex-wrap" role="group" aria-label="Vue">
          {VIEWS.map((v) => (
            <button key={v.key} aria-pressed={view === v.key} onClick={() => setView(v.key)}
              className={`h-9 px-3.5 rounded-xl text-[13.5px] font-semibold ${view === v.key ? "grad-brand" : "text-ink2 hover:bg-surface2"}`}>
              {v.label}
            </button>
          ))}
        </div>
        {view !== "list" && (
          <div className="flex items-center gap-2">
            <button onClick={() => setAnchor(shift(view, anchor, -1))} aria-label="Période précédente" className="w-10 h-10 grid place-items-center rounded-full border border-line bg-surface text-ink2 hover:bg-surface2"><ChevronLeft size={16} /></button>
            <button onClick={() => { setAnchor(new Date()); setSelected(todayKey); }} className="h-10 px-4 rounded-full border border-line bg-surface text-sm font-semibold text-ink hover:bg-surface2">Aujourd&apos;hui</button>
            <button onClick={() => setAnchor(shift(view, anchor, 1))} aria-label="Période suivante" className="w-10 h-10 grid place-items-center rounded-full border border-line bg-surface text-ink2 hover:bg-surface2"><ChevronRight size={16} /></button>
            <span className="text-[17px] font-extrabold text-ink capitalize ml-2 min-w-[9rem]">{p.label}</span>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-line" role="group" aria-label="Agendas affichés">
        {SCOPES.map((s) => (
          <button key={s.key} aria-pressed={scope === s.key} onClick={() => setScope(s.key)}
            className={`px-3 py-2.5 text-[14px] font-semibold -mb-px border-b-2 inline-flex items-center gap-2 ${scope === s.key ? "border-section text-section" : "border-transparent text-ink2 hover:text-ink"}`}>
            {s.label} <span className="num text-[11px] px-1.5 rounded-full bg-surface2 text-ink3">{counts[s.key]}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="min-w-0">
          {loading ? (
            <div className="h-96 rounded-[18px] bg-surface border border-line animate-pulse" />
          ) : view === "list" ? (
            days.length === 0 ? (
              <div className="surface-card p-10 text-center">
                <CalendarDays size={26} className="mx-auto text-ink3" />
                <p className="mt-2 text-sm text-ink2">Aucun événement dans les 90 prochains jours.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {days.map((day) => (
                  <section key={day}>
                    <h2 className="text-xs font-bold uppercase tracking-wide text-ink2 mb-2 capitalize">{dayLabel(byDay[day][0].startAt)}</h2>
                    <div className="surface-card divide-y divide-line overflow-hidden">
                      {byDay[day].map((it) => (
                        <button key={it._id} onClick={() => open(it)}
                          className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface2/40 ${it.status === "cancelled" ? "opacity-50" : ""}`}>
                          <span className="mt-1 w-1.5 self-stretch rounded-full shrink-0" style={{ background: colorOf(it) }} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-semibold text-ink ${it.status === "cancelled" ? "line-through" : ""}`}>{it.title}</span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: colorOf(it) }}>{calendarOf(it)}</span>
                              {!it.virtual && it.visibility === "shared" && <span className="inline-flex items-center gap-1 text-[11px] text-ink3"><Users size={12} /> Partagé{ownerName(it.ownerId) ? ` · ${ownerName(it.ownerId)}` : ""}</span>}
                              {it.status === "done" && <span className="text-[11px] text-pos">✓ Fait</span>}
                            </span>
                            <span className="text-xs text-ink2 flex items-center gap-2 flex-wrap mt-0.5">
                              <span>{it.allDay ? "Journée entière" : `${hhmm(it.startAt)}${it.endAt ? ` – ${hhmm(it.endAt)}` : ""}`}</span>
                              {it.location && <span className="inline-flex items-center gap-0.5"><MapPin size={11} />{it.location}</span>}
                              {it.meetingLink && <span className="inline-flex items-center gap-0.5 text-section"><Video size={11} /> En ligne</span>}
                              {it.virtual && it.description && <span className="text-ink3">{it.description}</span>}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )
          ) : view === "week" ? (
            <div className="grid grid-cols-1 sm:grid-cols-7 rounded-[18px] overflow-hidden border border-line bg-surface">
              {weekDays.map((d, i) => {
                const k = localDayKey(d), evs = byDay[k] || [];
                return (
                  <div key={k} className={`min-h-[260px] p-2 ${i ? "sm:border-l border-t sm:border-t-0" : ""} border-line ${k === selected ? "bg-section-soft/40" : ""}`}>
                    <button type="button" onClick={() => setSelected(k)} className="w-full flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{d.toLocaleDateString("fr-FR", { weekday: "short" })}</span>
                      <span className={`text-[13px] font-bold w-7 h-7 rounded-full grid place-items-center ${k === todayKey ? "bg-section text-onink" : "text-ink"}`}>{d.getDate()}</span>
                    </button>
                    <div className="space-y-1">{evs.map(e => <EventChip key={e._id} it={e} color={colorOf(e)} onClick={() => open(e)} />)}</div>
                  </div>
                );
              })}
            </div>
          ) : view === "month" ? (
            <MonthGrid year={p.months[0].y} month={p.months[0].m} byDay={byDay} selected={selected} colorOf={colorOf}
              onSelect={(d) => setSelected(localDayKey(d))} onEvent={open} />
          ) : (
            <div className={`grid grid-cols-1 ${cols} gap-5`}>
              {p.months.map((mm) => (
                <div key={`${mm.y}-${mm.m}`} className="surface-card p-2">
                  <MonthGrid year={mm.y} month={mm.m} byDay={byDay} compact selected={selected} colorOf={colorOf}
                    onSelect={(d) => setSelected(localDayKey(d))} onEvent={open} />
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-5 min-w-0">
          {/* Le jour choisi (aujourd'hui par défaut) */}
          <section className="bg-surface rounded-[22px] border border-line shadow-card p-4 space-y-3" aria-label={selLabel}>
            <div>
              <h2 className="text-[16px] font-extrabold text-ink capitalize">{selLabel}</h2>
              <p className="text-[12.5px] text-ink3">{nextUp ? `Prochain : ${nextUp.title} à ${hHour(nextUp.startAt)}` : dayItems.length ? "Plus rien d'horaire ce jour." : "Rien de prévu."}</p>
            </div>
            {conflict && (
              <p className="flex gap-2 items-start text-[12.5px] rounded-xl bg-warn-50 border border-warn/25 text-warn px-3 py-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span>{conflict.who} deux rendez-vous qui se chevauchent : {conflict.a.title} et {conflict.b.title}.</span>
              </p>
            )}
            {dayItems.map(it => (
              <button key={it._id} type="button" onClick={() => open(it)}
                className="w-full text-left rounded-xl border border-line px-3 py-2.5 flex gap-2.5 hover:bg-surface2/50">
                <span className="w-1 rounded-full self-stretch shrink-0" style={{ background: colorOf(it) }} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-ink2">{it.allDay ? "Journée entière" : `${hHour(it.startAt)}${it.endAt ? ` – ${hHour(it.endAt)}` : ""}`}</span>
                  <span className={`block text-[14px] font-bold text-ink leading-snug ${it.status === "cancelled" ? "line-through" : ""}`}>{it.title}</span>
                  <span className="block text-[12px] text-ink3 truncate">{[calendarOf(it), it.location, it.meetingLink ? "Visio" : ""].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            ))}
            <button type="button" onClick={() => newOn(selDate)}
              className="w-full h-10 rounded-xl border border-dashed border-section/40 text-[13px] font-semibold text-section hover:bg-section-soft/40">
              + Ajouter un événement ce jour
            </button>
          </section>

          {/* Agendas : afficher / masquer, export */}
          <section className="bg-surface rounded-[22px] border border-line shadow-card p-4 space-y-2" aria-label="Agendas">
            <h2 className="text-[15px] font-bold text-ink mb-1">Agendas</h2>
            {[...calendars.entries()].map(([name, n]) => {
              const color = calendarColor(name), on = !hidden.has(name);
              return (
                <label key={name} className="flex items-center gap-3 py-1 cursor-pointer">
                  <input type="checkbox" checked={on} onChange={() => toggle(name)} className="sr-only peer" />
                  <span className="w-[18px] h-[18px] rounded-[5px] grid place-items-center border peer-focus-visible:ring-2 peer-focus-visible:ring-section" style={on ? { background: color, borderColor: color } : { borderColor: color }} aria-hidden>
                    {on && <Check size={12} className="text-white" />}
                  </span>
                  <span className="flex-1 text-[14px] text-ink">{name}</span>
                  <span className="num text-[12px] text-ink3">{n}</span>
                </label>
              );
            })}
            <a href={`/api/agenda/ics?${new URLSearchParams({ from: p.from.toISOString(), to: p.to.toISOString() })}`}
              className="mt-2 w-full h-10 rounded-full border border-line text-[13px] font-semibold text-ink inline-flex items-center justify-center gap-2 hover:bg-surface2">
              <Download size={14} /> Exporter vers Outlook / Google (.ics)
            </a>
          </section>
        </aside>
      </div>

      {editing && <EventDialog item={editing} calendars={[...calendars.keys()].filter(n => !["Mon agenda", "Partagés", "Marchés publics", "Jours fériés"].includes(n))} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

interface DirUser { _id: string; firstName?: string; lastName?: string }

function normalizeParticipants(p: unknown): string[] {
  if (!Array.isArray(p)) return [];
  return (p as unknown[])
    .map((x) => (typeof x === "string" ? x : (x as { _id?: string })?._id))
    .filter((x): x is string => Boolean(x));
}

function EventDialog({ item, calendars, onClose, onSaved }: { item: Partial<AgendaItem>; calendars: string[]; onClose: () => void; onSaved: () => void }) {
  const id = item._id;
  const [form, setForm] = useState({
    title: item.title || "",
    type: (item.type || "reunion") as AgendaType,
    startAt: toLocalInput(item.startAt),
    endAt: item.endAt ? toLocalInput(item.endAt) : "",
    allDay: Boolean(item.allDay),
    location: item.location || "",
    meetingLink: item.meetingLink || "",
    visibility: (item.visibility || "personal") as "personal" | "shared",
    status: (item.status || "planned") as "planned" | "done" | "cancelled",
    description: item.description || "",
    calendar: item.calendar || "",
  });
  const [participants, setParticipants] = useState<string[]>(normalizeParticipants(item.participants));
  const [dir, setDir] = useState<DirUser[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Partage : lien public de la réunion.
  const [shareUrl, setShareUrl] = useState<string | null>(item.shareToken ? `${typeof window !== "undefined" ? window.location.origin : ""}/reunion/${item.shareToken}` : null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiJson("/api/agenda/directory").then((d) => setDir(d.success ? d.data : [])).catch(() => setDir([]));
  }, []);

  function toggleParticipant(uid: string) {
    setParticipants((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : [...p, uid]));
  }

  async function share() {
    if (!id) return;
    setSharing(true);
    try {
      const res = await apiSend("POST", `/api/agenda/${id}/share`);
      const d = res.data;
      if (res.ok) setShareUrl(`${window.location.origin}${d.data.path}`);
    } finally { setSharing(false); }
  }
  async function revoke() {
    if (!id) return;
    await apiSend("DELETE", `/api/agenda/${id}/share`);
    setShareUrl(null); setCopied(false);
  }
  function copy() {
    if (shareUrl) navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }

  async function save() {
    if (!form.title.trim()) { setError("Le titre est requis."); return; }
    setSaving(true); setError(null);
    try {
      const body = {
        ...form,
        participants,
        startAt: new Date(form.startAt).toISOString(),
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
      };
      const res = await fetch(id ? `/api/agenda/${id}` : "/api/agenda", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Enregistrement refusé");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!id || !(await confirmDialog({ title: "Supprimer cet événement ?", danger: true }))) return;
    try { await api.del(`/api/agenda/${id}`); onSaved(); }
    catch (e) { showToast(apiErrorMessage(e, "Suppression impossible."), "error"); }
  }

  return (
    <Modal open onClose={onClose} title={id ? "Modifier l'événement" : "Nouvel événement"} size="lg">
      <div className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <FormField label="Titre" required>
          <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Réunion d'équipe, visite terrain…" />
        </FormField>
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Type">
            <select className={selectCls} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AgendaType }))}>
              {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </FormField>
          <FormField label="Visibilité" hint="Partagé = visible par toute l'organisation.">
            <select className={selectCls} value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value as "personal" | "shared" }))}>
              <option value="personal">Personnel (mon agenda)</option>
              <option value="shared">Partagé (organisation)</option>
            </select>
          </FormField>
        </div>
        <FormField label="Agenda d'équipe" hint="Facultatif : « Direction », « Équipe commerciale »… pour le classer et le colorer.">
          <input className={inputCls} list="agenda-calendars" maxLength={60} value={form.calendar} onChange={(e) => setForm((f) => ({ ...f, calendar: e.target.value }))} placeholder="Mon agenda" />
          <datalist id="agenda-calendars">{[...new Set([...calendars, ...SUGGESTED_CALENDARS])].map(c => <option key={c} value={c} />)}</datalist>
        </FormField>
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Début">
            <input type="datetime-local" className={inputCls} value={form.startAt} onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))} />
          </FormField>
          <FormField label="Fin" hint="Facultatif.">
            <input type="datetime-local" className={inputCls} value={form.endAt} onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))} />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink2 cursor-pointer">
          <input type="checkbox" className="accent-section" checked={form.allDay} onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))} />
          Journée entière
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Lieu" hint="Facultatif.">
            <input className={inputCls} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Salle de réunion, Niamey…" />
          </FormField>
          <FormField label="Lien visio" hint="Facultatif.">
            <input className={inputCls} value={form.meetingLink} onChange={(e) => setForm((f) => ({ ...f, meetingLink: e.target.value }))} placeholder="https://…" />
          </FormField>
        </div>
        {id && (
          <FormField label="Statut">
            <select className={selectCls} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "planned" | "done" | "cancelled" }))}>
              <option value="planned">Prévu</option>
              <option value="done">Fait</option>
              <option value="cancelled">Annulé</option>
            </select>
          </FormField>
        )}
        <FormField label="Notes" hint="Ordre du jour, détails…">
          <textarea className={textareaCls} rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </FormField>

        {/* Participants conviés */}
        <FormField label="Participants" hint="Les collaborateurs cochés voient l'événement dans leur agenda.">
          {dir === null ? (
            <p className="text-xs text-ink3">Chargement des collaborateurs…</p>
          ) : dir.length === 0 ? (
            <p className="text-xs text-ink3">Aucun autre collaborateur dans l&apos;organisation.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-line2 divide-y divide-line">
              {dir.map((u) => {
                const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || "Sans nom";
                const on = participants.includes(u._id);
                return (
                  <label key={u._id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface2/40">
                    <input type="checkbox" className="accent-section" checked={on} onChange={() => toggleParticipant(u._id)} />
                    <span className="text-ink">{name}</span>
                  </label>
                );
              })}
            </div>
          )}
          {participants.length > 0 && <p className="mt-1 text-[11px] text-ink3">{participants.length} participant{participants.length > 1 ? "s" : ""} convié{participants.length > 1 ? "s" : ""}.</p>}
        </FormField>

        {/* Lien de réunion partageable */}
        <div className="rounded-xl border border-line bg-surface2/30 p-3 space-y-2">
          <p className="text-sm font-semibold text-ink flex items-center gap-1.5"><Link2 size={15} /> Lien de réunion</p>
          {!id ? (
            <p className="text-xs text-ink3">Enregistrez l&apos;événement pour générer un lien partageable.</p>
          ) : shareUrl ? (
            <>
              <div className="flex items-center gap-2">
                <input readOnly value={shareUrl} className={`${inputCls} text-xs`} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" onClick={copy} className={buttonClass("secondary", "md", "shrink-0")}>
                  {copied ? <><Check size={14} className="text-pos" /> Copié</> : <><Copy size={14} /> Copier</>}
                </button>
              </div>
              <button type="button" onClick={revoke} className="text-xs text-neg hover:underline">Révoquer le lien</button>
            </>
          ) : (
            <button type="button" onClick={share} disabled={sharing}
              className={buttonClass("primary", "md")}>
              <Link2 size={14} /> {sharing ? "Génération…" : "Générer un lien partageable"}
            </button>
          )}
          <p className="text-[11px] text-ink3">Toute personne disposant du lien verra l&apos;objet, l&apos;horaire, le lieu et le lien visio — sans se connecter.</p>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-line">
          {id
            ? <button onClick={remove} className="text-sm text-neg hover:underline inline-flex items-center gap-1.5"><Trash2 size={15} /> Supprimer</button>
            : <span />}
          <div className="flex gap-3">
            <button onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
            <button onClick={save} disabled={saving} className={buttonClass("primary", "md")}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
