"use client";
import { useEffect, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, LogIn, LogOut, UserX, Trash2 } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Pill, EmptyState } from "@/components/ui/Primitives";
import { buttonClass } from "@/components/ui/button-class";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { RestoNav } from "@/components/restauration/RestoNav";

const MONEY = (n?: number | null) => (n === undefined || n === null ? "—" : `${Math.round(n).toLocaleString("fr-FR")} FCFA`);
const H = (n?: number | null) => (n === undefined || n === null ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`);
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return dayOf(d); };
const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
const SERVICES = { midi: "Midi", soir: "Soir", jour: "Journée" } as const;
type Svc = keyof typeof SERVICES;
const HOURS: Record<Svc, [string, string]> = { midi: ["10:00", "15:00"], soir: ["17:00", "23:00"], jour: ["08:00", "17:00"] };

interface Shift { _id: string; employeeId: string; day: string; service: Svc; start: string; end: string; clockIn?: string; clockOut?: string; absent?: boolean; plannedHours: number; realHours: number | null }
interface Week { start: string; end: string; days: string[]; team: Array<{ employeeId: string; name: string; position?: string }>; shifts: Shift[] }
interface Month {
  month: string; monthlyHours: number;
  people: Array<{ employeeId: string; name: string; plannedHours: number; realHours: number; absences: number; hourlyCost?: number | null; cost?: number; staffMeals?: { value: number; count: number } | null }>;
  services: Array<{ service: Svc; label: string; plannedHours: number; realHours: number; cost?: number }>;
}

/**
 * Planning et pointage du personnel d'un restaurant : postes de la semaine,
 * arrivée et départ pointés, absences ; puis le mois — heures prévues et
 * réelles, coût par service et repas du personnel (pour qui gère la paie).
 */
export default function PlanningPage() {
  const [desks, setDesks] = useState<Array<{ _id: string; name: string }>>([]);
  const [deskId, setDeskId] = useState("");
  const [week, setWeek] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(d); });
  const [month, setMonth] = useState(() => dayOf(new Date()).slice(0, 7));
  const [add, setAdd] = useState<{ employeeId: string; day: string; service: Svc; start: string; end: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiJson("/api/comptoir/desks").then(d => { const l = (d.data ?? []) as Array<{ _id: string; name: string }>; setDesks(l); if (l[0]) setDeskId(x => x || l[0]._id); }).catch(() => {}); }, []);
  const w = useApi<Week | null>(deskId ? `/api/restauration/planning?deskId=${deskId}&week=${week}` : null, d => (d?.data as Week) ?? null, null, { quiet: true });
  const m = useApi<Month | null>(deskId ? `/api/restauration/planning?deskId=${deskId}&month=${month}` : null, d => (d?.data as Month) ?? null, null, { quiet: true });
  const today = dayOf(new Date());

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const r = await apiSend<{ error?: string }>("POST", "/api/restauration/planning", { deskId, ...body });
    setBusy(false);
    if (!r.ok) { showToast(r.data.error || "Action refusée", "error"); return false; }
    showToast(done, "success"); w.reload(); m.reload(); return true;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink inline-flex items-center gap-2"><CalendarClock size={22} /> Planning et pointage</h1>
          <p className="text-sm text-ink2">Qui travaille à quel service, l&apos;heure réelle d&apos;arrivée et de départ, et ce que coûte chaque service.</p>
        </div>
        <FormField label="Restaurant"><select className={selectCls} value={deskId} onChange={e => setDeskId(e.target.value)}>{desks.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></FormField>
      </div>
      <RestoNav />
      {w.error && <p className="text-sm text-neg">{w.error}</p>}

      <section className="surface-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setWeek(x => shift(x, -7))} className={buttonClass("ghost", "sm")} aria-label="Semaine précédente"><ChevronLeft size={15} /></button>
          <p className="font-semibold text-ink">Semaine du {w.data ? `${label(w.data.start)} au ${label(w.data.end)}` : "…"}</p>
          <button onClick={() => setWeek(x => shift(x, 7))} className={buttonClass("ghost", "sm")} aria-label="Semaine suivante"><ChevronRight size={15} /></button>
          <span className="flex-1" />
          {w.data?.team.length ? <button onClick={() => setAdd({ employeeId: w.data!.team[0].employeeId, day: w.data!.days.includes(today) ? today : w.data!.start, service: "midi", start: HOURS.midi[0], end: HOURS.midi[1] })} className={buttonClass("secondary", "sm")}><Plus size={14} /> Ajouter un poste</button> : null}
        </div>
        {add && w.data && (
          <div className="flex gap-2 flex-wrap items-end border border-line rounded-lg p-3">
            <FormField label="Collaborateur"><select className={selectCls} value={add.employeeId} onChange={e => setAdd({ ...add, employeeId: e.target.value })}>{w.data.team.map(t => <option key={t.employeeId} value={t.employeeId}>{t.name}</option>)}</select></FormField>
            <FormField label="Jour"><select className={selectCls} value={add.day} onChange={e => setAdd({ ...add, day: e.target.value })}>{w.data.days.map(d => <option key={d} value={d}>{label(d)}</option>)}</select></FormField>
            <FormField label="Service"><select className={selectCls} value={add.service} onChange={e => { const s = e.target.value as Svc; setAdd({ ...add, service: s, start: HOURS[s][0], end: HOURS[s][1] }); }}>{(Object.keys(SERVICES) as Svc[]).map(k => <option key={k} value={k}>{SERVICES[k]}</option>)}</select></FormField>
            <FormField label="Début"><input type="time" className={inputCls} value={add.start} onChange={e => setAdd({ ...add, start: e.target.value })} /></FormField>
            <FormField label="Fin"><input type="time" className={inputCls} value={add.end} onChange={e => setAdd({ ...add, end: e.target.value })} /></FormField>
            <button onClick={() => setAdd(null)} className={buttonClass("ghost", "sm")}>Annuler</button>
            <button disabled={busy} onClick={async () => { if (await send({ action: "save", ...add }, "Poste enregistré")) setAdd(null); }} className={buttonClass("primary", "sm")}>Enregistrer</button>
          </div>
        )}
        {w.loading && !w.data ? <div className="h-40 animate-pulse" /> : !w.data?.team.length ? (
          <EmptyState icon={<CalendarClock size={20} />} title="Personne n'est affecté à ce restaurant" hint="Affectez d'abord l'équipe dans « Équipe et paie »." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full min-w-[720px]">
              <thead><tr><th>Collaborateur</th>{w.data.days.map(d => <th key={d} className={d === today ? "text-section" : ""}>{label(d)}</th>)}</tr></thead>
              <tbody>
                {w.data.team.map(t => (
                  <tr key={t.employeeId} className="border-t border-line align-top">
                    <td className="font-medium">{t.name}{t.position ? <span className="block text-[11px] text-ink3">{t.position}</span> : null}</td>
                    {w.data!.days.map(d => (
                      <td key={d} className="space-y-1">
                        {w.data!.shifts.filter(s => s.employeeId === t.employeeId && s.day === d).map(s => (
                          <div key={s._id} className="rounded border border-line p-1.5 text-[12px] space-y-1">
                            <p className="font-semibold">{SERVICES[s.service]} {s.start}–{s.end}</p>
                            {s.absent ? <Pill tone="warn">absent</Pill>
                              : s.clockIn ? <p className="text-ink2">{hhmm(s.clockIn)} → {s.clockOut ? hhmm(s.clockOut) : "en poste"}{s.realHours !== null ? ` (${H(s.realHours)})` : ""}</p>
                              : null}
                            <div className="flex gap-1 flex-wrap">
                              {!s.absent && !s.clockIn && <button disabled={busy} onClick={() => send({ action: "in", id: s._id }, "Arrivée pointée")} className={buttonClass("secondary", "sm")} title="Pointer l'arrivée"><LogIn size={13} /></button>}
                              {s.clockIn && !s.clockOut && <button disabled={busy} onClick={() => send({ action: "out", id: s._id }, "Départ pointé")} className={buttonClass("secondary", "sm")} title="Pointer le départ"><LogOut size={13} /></button>}
                              {!s.clockIn && !s.absent && <button disabled={busy} onClick={() => send({ action: "absent", id: s._id }, "Absence notée")} className={buttonClass("ghost", "sm")} title="Absent"><UserX size={13} /></button>}
                              {!s.clockIn && <button disabled={busy} onClick={() => send({ action: "delete", id: s._id }, "Poste retiré")} className={buttonClass("ghost", "sm")} title="Retirer le poste"><Trash2 size={13} /></button>}
                            </div>
                          </div>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="surface-card p-4 space-y-3">
        <div className="flex items-end justify-between gap-2 flex-wrap">
          <div>
            <p className="font-semibold text-ink">Heures du mois</p>
            <p className="text-[12px] text-ink3">Heures réelles : pointées ; un poste non pointé compte pour ses heures prévues.{m.data?.people.some(p => p.cost !== undefined) ? ` Coût horaire = coût employeur du bulletin ÷ ${m.data.monthlyHours} h (base 40 h par semaine, à confirmer).` : ""}</p>
          </div>
          <FormField label="Mois"><input type="month" className={inputCls} value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></FormField>
        </div>
        {!m.data?.people.length ? <p className="text-sm text-ink3">Aucun poste ce mois-ci.</p> : <>
          <table className="table-dense w-full">
            <thead><tr><th>Collaborateur</th><th className="text-right">Prévu</th><th className="text-right">Réel</th><th className="text-right">Absences</th>{m.data.people[0].cost !== undefined && <><th className="text-right">Coût horaire</th><th className="text-right">Coût</th><th className="text-right">Repas du personnel</th></>}</tr></thead>
            <tbody>
              {m.data.people.map(p => (
                <tr key={p.employeeId} className="border-t border-line">
                  <td>{p.name}</td>
                  <td className="text-right font-mono">{H(p.plannedHours)}</td>
                  <td className={`text-right font-mono ${p.realHours < p.plannedHours ? "text-warn" : ""}`}>{H(p.realHours)}</td>
                  <td className="text-right font-mono">{p.absences || "—"}</td>
                  {p.cost !== undefined && <>
                    <td className="text-right font-mono">{p.hourlyCost === null ? <Pill tone="warn">bulletin à faire</Pill> : MONEY(p.hourlyCost)}</td>
                    <td className="text-right font-mono">{MONEY(p.cost)}</td>
                    <td className="text-right font-mono">{p.staffMeals ? `${MONEY(p.staffMeals.value)} (${p.staffMeals.count})` : "—"}</td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-3">
            {m.data.services.map(s => (
              <div key={s.service} className="rounded-lg border border-line px-3 py-2 text-sm">
                <p className="font-semibold">{s.label}</p>
                <p className="text-ink2">{H(s.realHours)} réelles / {H(s.plannedHours)} prévues{s.cost !== undefined ? ` · ${MONEY(s.cost)}` : ""}</p>
              </div>
            ))}
          </div>
          {m.data.people[0].cost !== undefined && <p className="text-[11px] text-ink3">Repas du personnel : valeur au coût des pertes « repas du personnel » rattachées au collaborateur. Avantage en nature à reporter, s&apos;il y a lieu, sur le bulletin (évaluation selon le barème applicable, à confirmer avec le comptable).</p>}
        </>}
      </section>
    </div>
  );
}
