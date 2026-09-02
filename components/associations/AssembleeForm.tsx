"use client";
import { useState } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
interface AssembleeFormProps { onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }
export function AssembleeForm({ onSave, onCancel }: AssembleeFormProps) {
  const [form, setForm] = useState({ title:"", type:"ordinary", date:"", location:"", quorumRequired:0, notes:"" });
  const [saving, setSaving] = useState(false);
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));
  return (
    <form onSubmit={async(e)=>{e.preventDefault();setSaving(true);await onSave(form);setSaving(false);}} className="space-y-4">
      <FormField label="Intitulé" required><input className={inputCls} value={form.title} onChange={e=>u("title",e.target.value)} placeholder="Ex: AG ordinaire 2025" required /></FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Type">
          <select className={selectCls} value={form.type} onChange={e=>u("type",e.target.value)}><option value="ordinary">Ordinaire</option><option value="extraordinary">Extraordinaire</option></select>
        </FormField>
        <FormField label="Date" required><input type="date" className={inputCls} value={form.date} onChange={e=>u("date",e.target.value)} required /></FormField>
      </div>
      <FormField label="Lieu" required><input className={inputCls} value={form.location} onChange={e=>u("location",e.target.value)} placeholder="Salle, adresse…" required /></FormField>
      <FormField label="Quorum requis (nb membres)"><input type="number" className={inputCls} value={form.quorumRequired} onChange={e=>u("quorumRequired",Number(e.target.value))} min={0} /></FormField>
      <FormField label="Notes préparatoires"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e=>u("notes",e.target.value)} /></FormField>
      <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"…":"Créer l'assemblée"}</button>
      </div>
    </form>
  );
}
