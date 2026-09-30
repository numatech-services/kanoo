"use client";
import { useEffect, useState } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { PROJECT_STATUS_FR } from "@/lib/vocabulary";

export interface ProjectEditValue {
  name: string; description?: string; status: string; projectType?: string;
  clientId?: string | null; managerId?: string | null; startDate?: string; endDate?: string;
  budget?: number; bailleurName?: string;
}
type Ref = string | { _id: string } | null | undefined;
const idOf = (v: Ref) => (v && typeof v === "object" ? v._id : v ?? "");

/** Fiche projet : identité, état, client, responsable, dates et budget (finances). */
export function ProjectEditForm({ initial, showBudget, onSave, onCancel }: {
  initial: Omit<ProjectEditValue, "clientId" | "managerId"> & { clientId?: Ref; managerId?: Ref; code: string };
  showBudget: boolean;
  onSave: (v: ProjectEditValue) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    name: initial.name, description: initial.description ?? "", status: initial.status, projectType: initial.projectType ?? "internal",
    clientId: idOf(initial.clientId), managerId: idOf(initial.managerId),
    startDate: initial.startDate?.slice(0, 10) ?? "", endDate: initial.endDate?.slice(0, 10) ?? "",
    budget: initial.budget ?? 0, bailleurName: initial.bailleurName ?? "",
  });
  const [clients, setClients] = useState<Array<{ _id: string; name: string }>>([]);
  const [users, setUsers] = useState<Array<{ _id: string; firstName?: string; lastName?: string }>>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/clients?limit=100", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => d?.data?.items && setClients(d.data.items)).catch(() => {});
    fetch("/api/agenda/directory", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => d?.data && setUsers(d.data)).catch(() => {});
  }, []);
  const u = (k: keyof typeof f, v: string | number) => setF(p => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) { setError("Nom obligatoire."); return; }
    if (f.startDate && f.endDate && f.endDate < f.startDate) { setError("La fin précède le début."); return; }
    setSaving(true); setError("");
    try {
      await onSave({
        name: f.name.trim(), description: f.description, status: f.status, projectType: f.projectType,
        clientId: f.clientId || null, managerId: f.managerId || null,
        startDate: f.startDate || undefined, endDate: f.endDate || undefined, bailleurName: f.bailleurName,
        ...(showBudget ? { budget: Number(f.budget) || 0 } : {}),
      });
    } catch (err) { setError(err instanceof Error ? err.message : "Enregistrement impossible"); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
      <div className="grid sm:grid-cols-3 gap-3">
        <FormField label="Code"><input className={inputCls} value={initial.code} disabled /></FormField>
        <FormField label="Nom" required className="sm:col-span-2"><input className={inputCls} value={f.name} onChange={e => u("name", e.target.value)} required /></FormField>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <FormField label="État">
          <select className={selectCls} value={f.status} onChange={e => u("status", e.target.value)}>
            {Object.entries(PROJECT_STATUS_FR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </FormField>
        <FormField label="Type">
          <select className={selectCls} value={f.projectType} onChange={e => u("projectType", e.target.value)}>
            <option value="internal">Interne</option><option value="client">Client</option><option value="ong">ONG / bailleur</option>
            <option value="public">Public</option><option value="research">Recherche</option><option value="other">Autre</option>
          </select>
        </FormField>
        <FormField label="Client">
          <select className={selectCls} value={f.clientId} onChange={e => u("clientId", e.target.value)}>
            <option value="">—</option>{clients.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Chef de projet">
          <select className={selectCls} value={f.managerId} onChange={e => u("managerId", e.target.value)}>
            <option value="">—</option>{users.map(x => <option key={x._id} value={x._id}>{x.firstName} {x.lastName}</option>)}
          </select>
        </FormField>
        <FormField label="Début"><input type="date" className={inputCls} value={f.startDate} onChange={e => u("startDate", e.target.value)} /></FormField>
        <FormField label="Fin prévue"><input type="date" className={inputCls} value={f.endDate} onChange={e => u("endDate", e.target.value)} /></FormField>
        {showBudget && <FormField label="Budget (XOF)"><input type="number" min={0} className={inputCls} value={f.budget} onChange={e => u("budget", Number(e.target.value))} /></FormField>}
        <FormField label="Bailleur / financeur"><input className={inputCls} value={f.bailleurName} onChange={e => u("bailleurName", e.target.value)} /></FormField>
      </div>
      <FormField label="Description"><textarea className={textareaCls} rows={3} value={f.description} onChange={e => u("description", e.target.value)} /></FormField>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
        <button type="submit" disabled={saving} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold disabled:opacity-60">{saving ? "Enregistrement…" : "Enregistrer"}</button>
      </div>
    </form>
  );
}
