"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Users, MapPin, Video, Trash2, CalendarDays } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls, selectCls } from "@/components/ui/FormField";
import { AgendaItem, AgendaType, TYPE_META, itemColor, ownerName } from "./types";

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then((r) => r.json());
  return csrfToken as string;
}

type Scope = "all" | "mine" | "shared";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "mine", label: "Mon agenda" },
  { key: "shared", label: "Partagés" },
];

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

/** Pour un <input type="datetime-local"> : ISO local sans secondes ni fuseau. */
function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function AgendaView() {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<AgendaItem> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 90);
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), scope });
    fetch(`/api/agenda?${q}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setItems(d.success ? d.data : []))
      .finally(() => setLoading(false));
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  // Regroupement par jour, dans l'ordre chronologique.
  const groups: Record<string, AgendaItem[]> = {};
  for (const it of items) (groups[dayKey(it.startAt)] ||= []).push(it);
  const days = Object.keys(groups).sort();

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="page-head">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><CalendarDays size={22} /> Agenda</h1>
          <p className="text-sm text-ink2">Vos réunions et activités, plus les agendas partagés de l'organisation.</p>
        </div>
        <button onClick={() => setEditing({ type: "reunion", visibility: "personal", startAt: new Date().toISOString() })}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Nouvel événement
        </button>
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
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 surface-card animate-pulse" />)}</div>
      ) : days.length === 0 ? (
        <div className="surface-card p-10 text-center">
          <CalendarDays size={26} className="mx-auto text-ink3" />
          <p className="mt-2 text-sm text-ink2">Aucun événement à venir dans cette vue.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {days.map((day) => (
            <section key={day}>
              <h2 className="text-xs font-bold uppercase tracking-wide text-ink2 mb-2 capitalize">{dayLabel(groups[day][0].startAt)}</h2>
              <div className="surface-card divide-y divide-line overflow-hidden">
                {groups[day].map((it) => (
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
      )}

      {editing && <EventDialog item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form.title.trim()) { setError("Le titre est requis."); return; }
    setSaving(true); setError(null);
    try {
      const body = {
        ...form,
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
    if (!id || !confirm("Supprimer cet événement ?")) return;
    await fetch(`/api/agenda/${id}`, { method: "DELETE", credentials: "include", headers: { "x-csrf-token": await csrf() } });
    onSaved();
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

        <div className="flex justify-between items-center pt-3 border-t border-line">
          {id
            ? <button onClick={remove} className="text-sm text-neg hover:underline inline-flex items-center gap-1.5"><Trash2 size={15} /> Supprimer</button>
            : <span />}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
            <button onClick={save} disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
