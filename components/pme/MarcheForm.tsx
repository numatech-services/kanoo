"use client";
import { useState } from "react";
import { FormField, inputCls, textareaCls } from "@/components/ui/FormField";
import { determineProcedureMarche, LIBELLES_PROCEDURES } from "@/lib/niger-fiscal";
import { buttonClass } from "@/components/ui/button-class";
interface MarcheFormProps { initial?: Record<string, unknown>; onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }
export function MarcheForm({ initial, onSave, onCancel }: MarcheFormProps) {
  const [form, setForm] = useState({ object: String(initial?.object||""), estimatedAmount: Number(initial?.estimatedAmount||0), bidsDeadline: String(initial?.bidsDeadline||"").slice(0,10), notes: String(initial?.notes||"") });
  const [saving, setSaving] = useState(false);
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));
  const procedure = form.estimatedAmount > 0 ? determineProcedureMarche(form.estimatedAmount) : null;
  return (
    <form onSubmit={async(e)=>{e.preventDefault();setSaving(true);await onSave(form);setSaving(false);}} className="space-y-4">
      <FormField label="Objet du marché" required><textarea className={textareaCls} rows={2} value={form.object} onChange={e=>u("object",e.target.value)} required /></FormField>
      <FormField label="Montant estimé (FCFA)" required hint={procedure ? `Procédure applicable : ${LIBELLES_PROCEDURES[procedure]}` : undefined}>
        <input type="number" className={inputCls} value={form.estimatedAmount} onChange={e=>u("estimatedAmount",Number(e.target.value))} min={0} required />
      </FormField>
      {procedure && <div className="p-3 bg-warn-50 border border-warn/25 rounded-xl text-xs text-warn font-medium">{LIBELLES_PROCEDURES[procedure]}</div>}
      <FormField label="Date limite de dépôt des offres"><input type="date" className={inputCls} value={form.bidsDeadline} onChange={e=>u("bidsDeadline",e.target.value)} /></FormField>
      <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e=>u("notes",e.target.value)} /></FormField>
      <div className="flex justify-end gap-3 pt-3 border-t border-line">
        <button type="button" onClick={onCancel} className={buttonClass("secondary", "md")}>Annuler</button>
        <button type="submit" disabled={saving} className={buttonClass("primary", "md")}>{saving?"…":"Créer le marché"}</button>
      </div>
    </form>
  );
}
