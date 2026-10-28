"use client";
import { useState } from "react";
import { Clock, Plus, Trash2 } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import { formatMoney } from "@/lib/format";

interface Entry { _id: string; date: string; hours: number; note?: string; taskId?: string; billable?: boolean; userId?: { _id: string; firstName?: string; lastName?: string } }
interface Data { items: Entry[]; people: Array<{ name: string; hours: number; cost: number | null }>; totalHours: number; estimatedCost?: number }

const today = () => new Date().toISOString().slice(0, 10);
const h = (n: number) => `${n.toLocaleString("fr-FR")} h`;

/**
 * Temps passés sur le projet : saisie (le sien), total par personne et, pour
 * la direction et la comptabilité, coût interne estimé.
 */
export function ProjectTime({ projectId, tasks, canEdit, money }: { projectId: string; tasks: Array<{ _id: string; label: string }>; canEdit: boolean; money: boolean }) {
  const { data, reload } = useApi<Data>(`/api/projects/${projectId}/time`, d => d?.data ?? { items: [], people: [], totalHours: 0 }, { items: [], people: [], totalHours: 0 });
  const [form, setForm] = useState({ date: today(), hours: "", taskId: "", note: "", billable: true });
  const [busy, setBusy] = useState(false);
  const taskLabel = new Map(tasks.map(t => [t._id, t.label]));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await apiSend("POST", `/api/projects/${projectId}/time`, { ...form, hours: Number(form.hours), taskId: form.taskId || undefined });
    setBusy(false);
    if (!res.ok) { showToast(res.data?.error || "Saisie refusée", "error"); return; }
    setForm(f => ({ ...f, hours: "", note: "" }));
    reload();
  }
  async function remove(entry: Entry) {
    if (!(await confirmDialog({ title: "Retirer ce temps ?", danger: true }))) return;
    const res = await apiSend("DELETE", `/api/projects/${projectId}/time/${entry._id}`);
    if (!res.ok) { showToast(res.data?.error || "Suppression refusée", "error"); return; }
    reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-ink inline-flex items-center gap-2"><Clock size={16} /> Temps passé : {h(data.totalHours)}</h3>
        {money && data.estimatedCost !== undefined && <p className="text-sm text-ink2">Coût interne estimé : <b className="text-ink">{formatMoney(data.estimatedCost)}</b> <span className="text-xs text-ink3">(salaire de base ÷ 173,33 h)</span></p>}
      </div>

      <form onSubmit={add} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
        <div className="sm:col-span-2"><FormField label="Date"><input type="date" className={inputCls} max={today()} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></FormField></div>
        <div className="sm:col-span-2"><FormField label="Heures"><input type="number" min={0.25} max={24} step={0.25} required className={inputCls} value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} /></FormField></div>
        <div className="col-span-2 sm:col-span-3"><FormField label="Tâche">
          <select className={selectCls} value={form.taskId} onChange={e => setForm(f => ({ ...f, taskId: e.target.value }))}>
            <option value="">— Projet —</option>{tasks.map(t => <option key={t._id} value={t._id}>{t.label}</option>)}
          </select>
        </FormField></div>
        <div className="col-span-2 sm:col-span-3"><FormField label="Note"><input className={inputCls} maxLength={300} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></FormField></div>
        <div className="col-span-2 sm:col-span-2"><button disabled={busy || !form.hours} className={buttonClass("primary", "md", "w-full")}><Plus size={14} /> Saisir</button></div>
        <label className="col-span-2 sm:col-span-12 text-xs inline-flex items-center gap-2"><input type="checkbox" checked={form.billable} onChange={e => setForm(f => ({ ...f, billable: e.target.checked }))} className="accent-section" /> Temps facturable au client</label>
      </form>

      {data.people.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-2">
          {data.people.map(p => (
            <div key={p.name} className="surface-card p-3">
              <p className="text-sm font-semibold text-ink">{p.name}</p>
              <p className="text-xs text-ink2">{h(p.hours)}{money && p.cost !== null ? ` · ${formatMoney(p.cost)}` : ""}</p>
            </div>
          ))}
        </div>
      )}

      {data.items.length === 0 ? <p className="text-sm text-ink3">Aucun temps saisi.</p> : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead><tr><th>Date</th><th>Personne</th><th>Tâche</th><th>Note</th><th className="text-right">Heures</th><th></th></tr></thead>
            <tbody>
              {data.items.map(e => (
                <tr key={e._id}>
                  <td className="text-ink2 whitespace-nowrap">{new Date(e.date).toLocaleDateString("fr-FR")}</td>
                  <td className="text-ink">{e.userId ? `${e.userId.firstName ?? ""} ${e.userId.lastName ?? ""}` : "—"}</td>
                  <td className="text-ink2">{e.taskId ? taskLabel.get(e.taskId) ?? "—" : "—"}</td>
                  <td className="text-ink2">{e.note ?? ""}{e.billable === false && <span className="ml-1 text-[11px] text-ink3">(non facturable)</span>}</td>
                  <td className="text-right font-mono">{e.hours.toLocaleString("fr-FR")}</td>
                  <td className="text-right">{canEdit && <button onClick={() => remove(e)} className="p-1 text-ink3 hover:text-neg" title="Retirer"><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
