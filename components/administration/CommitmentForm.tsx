"use client";
import { useState, useEffect } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
interface Chapter { _id: string; code: string; label: string; allocatedAmount: number; engagedAmount: number; }
interface CommitmentFormProps { onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }
export function CommitmentForm({ onSave, onCancel }: CommitmentFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [mounted, setMounted] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [form, setForm] = useState({ chapterId:"", label:"", amount:0, date:today, notes:"" });
  const [saving, setSaving] = useState(false);
  useEffect(()=>{ setMounted(true); fetch(`/api/budget?year=${new Date().getFullYear()}&flat=true`,{credentials:"include"}).then(r=>r.json()).then(d=>setChapters(d.data?.chapters||[])); },[]);
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));
  const selectedChapter = chapters.find(c => c._id === form.chapterId);
  const available = selectedChapter ? selectedChapter.allocatedAmount - selectedChapter.engagedAmount : null;
  if (!mounted) return null;
  return (
    <form onSubmit={async(e)=>{e.preventDefault();setSaving(true);await onSave(form);setSaving(false);}} className="space-y-4">
      <FormField label="Chapitre budgétaire" required>
        <select className={selectCls} value={form.chapterId} onChange={e=>u("chapterId",e.target.value)} required>
          <option value="">Choisir un chapitre…</option>
          {chapters.map(c=><option key={c._id} value={c._id}>{c.code} — {c.label} (Dispo : {(c.allocatedAmount-c.engagedAmount).toLocaleString("fr-FR")} XOF)</option>)}
        </select>
      </FormField>
      {available !== null && (
        <div className={`p-3 rounded-xl text-sm ${available >= form.amount ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {available >= form.amount ? "✅" : "❌"} Crédit disponible : <strong>{available.toLocaleString("fr-FR")} XOF</strong>
        </div>
      )}
      <FormField label="Libellé de l'engagement" required><input className={inputCls} value={form.label} onChange={e=>u("label",e.target.value)} required /></FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Montant (XOF)" required><input type="number" className={inputCls} value={form.amount} onChange={e=>u("amount",Number(e.target.value))} min={0} required /></FormField>
        <FormField label="Date" required><input type="date" className={inputCls} value={form.date} onChange={e=>u("date",e.target.value)} required /></FormField>
      </div>
      <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e=>u("notes",e.target.value)} /></FormField>
      <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving || (available !== null && available < form.amount)} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"…":"Créer l'engagement"}</button>
      </div>
    </form>
  );
}
