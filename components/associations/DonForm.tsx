"use client";
import { useState } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
interface DonFormProps { onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }
export function DonForm({ onSave, onCancel }: DonFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ donorType:"individual", donorName:"", donorContact:"", amount:0, currency:"XOF", campaign:"", date:today, paymentMethod:"cash", notes:"" });
  const [saving, setSaving] = useState(false);
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));
  return (
    <form onSubmit={async(e)=>{e.preventDefault();setSaving(true);await onSave(form);setSaving(false);}} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Type de donateur">
          <select className={selectCls} value={form.donorType} onChange={e=>u("donorType",e.target.value)}><option value="individual">Particulier</option><option value="company">Entreprise / ONG</option><option value="anonymous">Anonyme</option></select>
        </FormField>
        {form.donorType !== "anonymous" && (
          <FormField label="Nom du donateur"><input className={inputCls} value={form.donorName} onChange={e=>u("donorName",e.target.value)} /></FormField>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Montant" required><input type="number" className={inputCls} value={form.amount} onChange={e=>u("amount",Number(e.target.value))} min={1} required /></FormField>
        <FormField label="Devise"><select className={selectCls} value={form.currency} onChange={e=>u("currency",e.target.value)}><option value="XOF">XOF</option><option value="EUR">EUR</option><option value="USD">USD</option></select></FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Date du don" required><input type="date" className={inputCls} value={form.date} onChange={e=>u("date",e.target.value)} required /></FormField>
        <FormField label="Mode de versement"><select className={selectCls} value={form.paymentMethod} onChange={e=>u("paymentMethod",e.target.value)}><option value="cash">Espèces</option><option value="bank_transfer">Virement</option><option value="mobile_money">Mobile Money</option><option value="cheque">Chèque</option></select></FormField>
      </div>
      <FormField label="Campagne / Projet"><input className={inputCls} value={form.campaign} onChange={e=>u("campaign",e.target.value)} placeholder="Ex: Fonds d'urgence 2025" /></FormField>
      <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e=>u("notes",e.target.value)} /></FormField>
      <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"…":"Enregistrer le don"}</button>
      </div>
    </form>
  );
}
