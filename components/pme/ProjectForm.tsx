"use client";
import { useState } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
interface ProjectFormProps { initial?: Record<string, unknown>; onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; defaultType?: string; }
export function ProjectForm({ initial, onSave, onCancel, defaultType = "internal" }: ProjectFormProps) {
  const [form, setForm] = useState({ code: String(initial?.code||""), name: String(initial?.name||""), budget: Number(initial?.budget||0), startDate: String(initial?.startDate||"").slice(0,10), endDate: String(initial?.endDate||"").slice(0,10), description: String(initial?.description||"") });
  const [saving, setSaving] = useState(false);
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));
  return (
    <form onSubmit={async(e)=>{e.preventDefault();setSaving(true);await onSave(form);setSaving(false);}} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Code" required><input className={inputCls} value={form.code} onChange={e=>u("code",e.target.value)} placeholder="PRJ-001" required /></FormField>
        <FormField label="Budget (XOF)"><input type="number" className={inputCls} value={form.budget} onChange={e=>u("budget",Number(e.target.value))} min={0} /></FormField>
      </div>
      <FormField label="Nom du projet" required><input className={inputCls} value={form.name} onChange={e=>u("name",e.target.value)} required /></FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Date de début"><input type="date" className={inputCls} value={form.startDate} onChange={e=>u("startDate",e.target.value)} /></FormField>
        <FormField label="Date de fin prévue"><input type="date" className={inputCls} value={form.endDate} onChange={e=>u("endDate",e.target.value)} /></FormField>
      </div>
      <FormField label="Description"><textarea className={textareaCls} rows={3} value={form.description} onChange={e=>u("description",e.target.value)} /></FormField>
      <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"…":"Enregistrer"}</button>
      </div>
    </form>
  );
}
