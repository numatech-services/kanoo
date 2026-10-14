"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Users, MapPin, Video, Trash2, CalendarDays, ChevronLeft, ChevronRight, Link2, Copy, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls, selectCls } from "@/components/ui/FormField";
import { AgendaItem, AgendaType, TYPE_META, itemColor, ownerName } from "./types";
import { MonthGrid, localDayKey } from "./CalendarGrid";

import { confirmDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
import { csrfToken as getCsrfToken, apiJson, api, apiErrorMessage, apiSend } from "@/lib/api-client";
import { showToast } from "@/components/ui/Toast";
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

type View = "list" | "month" | "quarter" | "semester" | "year";
const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "Liste" },
  { key: "month", label: "Mois" },
  { key: "quarter", label: "Trimestre" },
  { key: "semester", label: "Semestre" },
  { key: "year", label: "Année" },
];

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

/** Pour un <input type="datetime-local"> : ISO local sans secondes ni fuseau. */
function toLocalInput(iso?: string | Date): string {
  const d = iso ? new Date(iso) : new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

/** Fenêtre de dates + mois à afficher, selon la vue et la date d'ancrage. */
function period(view: View, anchor: Date): { from: Date; to: Date; months: { y: number; m: number }[]; label: string } {
  const y = anchor.getFullYear(), m = anchor.getMonth();
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
  // year
  const months = Array.from({ length: 12 }, (_, i) => ({ y, m: i }));
  return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), months, label: `${y}` };
}

function shift(view: View, anchor: Date, dir: 1 | -1): Date {
  const d = new Date(anchor);
  if (view === "month") d.setMonth(d.getMonth() + dir);
  else if (view === "quarter") d.setMonth(d.getMonth() + 3 * dir);
  else if (view === "semester") d.setMonth(d.getMonth() + 6 * dir);
  else d.setFullYear(d.getFullYear() + dir);
  return d;
}

export function AgendaView() {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<AgendaItem> | null>(null);

  // Fenêtre de récupération : la liste montre 90 jours à venir ; les grilles
  // suivent la période affichée.
  const grid = view !== "list";
  const load = useCallback(() => {
    setLoading(true);
    let from: Date, to: Date;
    if (grid) { const p = period(view, anchor); from = p.from; to = p.to; }
    else { from = new Date(); from.setHours(0, 0, 0, 0); to = new Date(from); to.setDate(to.getDate() + 90); }
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), scope });
    apiJson(`/api/agenda?${q}`)
      .then((d) => setItems(d.success ? d.data : []))
      .finally(() => setLoading(false));
  }, [scope, view, anchor, grid]);
  useEffect(() => { load(); }, [load]);

  // Regroupement par jour (heure locale).
  const byDay: Record<string, AgendaItem[]> = {};
  for (const it of items) (byDay[localDayKey(new Date(it.startAt))] ||= []).push(it);
  const days = Object.keys(byDay).sort();

  function newOn(d: Date) {
    const s = new Date(d); s.setHours(9, 0, 0, 0);
    setEditing({ type: "reunion", visibility: "personal", startAt: s.toISOString() });
  }

  const p = grid ? period(view, anchor) : null;
  const cols = view === "quarter" ? "lg:grid-cols-3" : view === "semester" ? "md:grid-cols-2 lg:grid-cols-3" : view === "year" ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "";

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="page-head">
        <div>
          <h1 className="page-title flex items-center gap-2"><CalendarDays size={22} /> Agenda</h1>
          <p className="text-sm text-ink2">Vos réunions et activités, plus les agendas partagés de l'organisation.</p>
        </div>
        <button onClick={() => setEditing({ type: "reunion", visibility: "personal", startAt: new Date().toISOString() })}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Nouvel événement
        </button>
      </div>

      {/* Barre d'outils : vue + portée + navigation de période */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 flex-wrap">
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={`px-3 h-9 rounded-lg text-sm font-medium ${view === v.key ? "bg-section text-white" : "text-ink2 hover:bg-surface2 border border-line"}`}>
              {v.label}
            </button>
          ))}
        </div>
        {grid && (
          <div className="flex items-center gap-2">
            <button onClick={() => setAnchor(shift(view, anchor, -1))} className="w-9 h-9 grid place-items-center rounded-lg border border-line text-ink2 hover:bg-surface2"><ChevronLeft size={16} /></button>
            <button onClick={() => setAnchor(new Date())} className="px-3 h-9 rounded-lg border border-line text-sm text-ink2 hover:bg-surface2">Aujourd&apos;hui</button>
            <button onClick={() => setAnchor(shift(view, anchor, 1))} className="w-9 h-9 grid place-items-center rounded-lg border border-line text-ink2 hover:bg-surface2"><ChevronRight size={16} /></button>
            <span className="text-sm font-semibold text-ink capitalize ml-1 min-w-[9rem]">{p!.label}</span>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-line">
        {SCOPES.map((s) => (
          <button key={s.key} onClick={() => setScope(s.key)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${scope === s.key ? "border-section text-section" : "border-transparent text-ink2 hover:text-ink"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-72 surface-card animate-pulse" />
      ) : view === "list" ? (
        days.length === 0 ? (
          <div className="surface-card p-10 text-center">
            <CalendarDays size={26} className="mx-auto text-ink3" />
            <p className="mt-2 text-sm text-ink2">Aucun événement à venir dans cette vue.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {days.map((day) => (
              <section key={day}>
                <h2 className="text-xs font-bold uppercase tracking-wide text-ink2 mb-2 capitalize">{dayLabel(byDay[day][0].startAt)}</h2>
                <div className="surface-card divide-y divide-line overflow-hidden">
                  {byDay[day].map((it) => (
                    <button key={it._id} onClick={() => setEditing(it)}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface2/40 ${it.status === "cancelled" ? "opacity-50" : ""}`}>
                      <span className="mt-1 w-1.5 self-stretch rounded-full shrink-0" style={{ background: itemColor(it) }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-semibold text-ink ${it.status === "cancelled" ? "line-through" : ""}`}>{it.title}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: itemColor(it) }}>{TYPE_META[it.type].label}</span>
                          {it.visibility === "shared" && <span className="inline-flex items-center gap-1 text-[11px] text-ink3"><Users size={12} /> Partagé{ownerName(it.ownerId) ? ` · ${ownerName(it.ownerId)}` : ""}</span>}
                          {it.status === "done" && <span className="text-[11px] text-pos">✓ Fait</span>}
                        </span>
                        <span className="text-xs text-ink2 flex items-center gap-2 flex-wrap mt-0.5">
                          <span>{it.allDay ? "Journée entière" : `${hhmm(it.startAt)}${it.endAt ? ` – ${hhmm(it.endAt)}` : ""}`}</span>
                          {it.location && <span className="inline-flex items-center gap-0.5"><MapPin size={11} />{it.location}</span>}
                          {it.meetingLink && <span className="inline-flex items-center gap-0.5 text-section"><Video size={11} /> En ligne</span>}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : view === "month" ? (
        <div className="surface-card p-2">
          <MonthGrid year={p!.months[0].y} month={p!.months[0].m} byDay={byDay} onDay={newOn} onEvent={setEditing} />
        </div>
      ) : (
        <div className={`grid grid-cols-1 ${cols} gap-5`}>
          {p!.months.map((mm) => (
            <div key={`${mm.y}-${mm.m}`} className="surface-card p-2">
              <MonthGrid year={mm.y} month={mm.m} byDay={byDay} compact onDay={newOn} onEvent={setEditing} />
            </div>
          ))}
        </div>
      )}

      {editing && <EventDialog item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
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

function EventDialog({ item, onClose, onSaved }: { item: Partial<AgendaItem>; onClose: () => void; onSaved: () => void }) {
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
  });
  const [participants, setParticipants] = useState<string[]>(normalizeParticipants(item.participants));
  const [dir, setDir] = useState<DirUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Partage : lien public de la réunion.
  const [shareUrl, setShareUrl] = useState<string | null>(item.shareToken ? `${typeof window !== "undefined" ? window.location.origin : ""}/reunion/${item.shareToken}` : null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiJson("/api/agenda/directory").then((d) => d.success && setDir(d.data)).catch(() => {});
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
          {dir.length === 0 ? (
            <p className="text-xs text-ink3">Chargement des collaborateurs…</p>
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
