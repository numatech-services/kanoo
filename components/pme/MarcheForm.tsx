"use client";
import { useState } from "react";
import { FormField, inputCls, textareaCls } from "@/components/ui/FormField";
import { determineProcedureMarche, LIBELLES_PROCEDURES } from "@/lib/niger-fiscal";
interface MarcheFormProps { initial?: Record<string, unknown>; onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }
export function MarcheForm({ initial, onSave, onCancel }: MarcheFormProps) {
  const [form, setForm] = useState({ object: String(initial?.object||""), estimatedAmount: Number(initial?.estimatedAmount||0), bidsDeadline: String(initial?.bidsDeadline||"").slice(0,10), notes: String(initial?.notes||"") });
  const [saving, setSaving] = useState(false);
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));
  const procedure = form.estimatedAmount > 0 ? determineProcedureMarche(form.estimatedAmount) : null;
  return (
    <form onSubmit={async(e)=>{e.preventDefault();setSaving(true);await onSave(form);setSaving(false);}} className="space-y-4">
      <FormField label="Objet du marché" required><textarea className={textareaCls} rows={2} value={form.object} onChange={e=>u("object",e.target.value)} required /></FormField>
      <FormField label="Montant estimé (XOF)" required hint={procedure ? `Procédure applicable : ${LIBELLES_PROCEDURES[procedure]}` : undefined}>
        <input type="number" className={inputCls} value={form.estimatedAmount} onChange={e=>u("estimatedAmount",Number(e.target.value))} min={0} required />
      </FormField>
      {procedure && <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium">⚖️ {LIBELLES_PROCEDURES[procedure]}</div>}
      <FormField label="Date limite de dépôt des offres"><input type="date" className={inputCls} value={form.bidsDeadline} onChange={e=>u("bidsDeadline",e.target.value)} /></FormField>
      <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e=>u("notes",e.target.value)} /></FormField>
      <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"…":"Créer le marché"}</button>
      </div>
    </form>
  );
}
