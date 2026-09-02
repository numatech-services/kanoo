"use client";
import { useState, useEffect } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
interface Member { _id: string; firstName: string; lastName: string; code: string; }
interface CotisationFormProps { onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }
export function CotisationForm({ onSave, onCancel }: CotisationFormProps) {
  const [mounted, setMounted] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ memberId:"", year:new Date().getFullYear(), amount:0, paymentMethod:"cash", paid:true });
  const [saving, setSaving] = useState(false);
  useEffect(()=>{ setMounted(true); fetch("/api/membres?limit=200&status=active",{credentials:"include"}).then(r=>r.json()).then(d=>setMembers(d.data?.items||[])); },[]);
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));
  if (!mounted) return null;
  return (
    <form onSubmit={async(e)=>{e.preventDefault();setSaving(true);await onSave(form);setSaving(false);}} className="space-y-4">
      <FormField label="Adhérent" required>
        <select className={selectCls} value={form.memberId} onChange={e=>u("memberId",e.target.value)} required>
          <option value="">Choisir un adhérent…</option>
          {members.map(m=><option key={m._id} value={m._id}>{m.firstName} {m.lastName} ({m.code})</option>)}
        </select>
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Année" required><input type="number" className={inputCls} value={form.year} onChange={e=>u("year",Number(e.target.value))} required /></FormField>
        <FormField label="Montant (XOF)" required><input type="number" className={inputCls} value={form.amount} onChange={e=>u("amount",Number(e.target.value))} min={0} required /></FormField>
      </div>
      <FormField label="Mode de paiement">
        <select className={selectCls} value={form.paymentMethod} onChange={e=>u("paymentMethod",e.target.value)}>
          <option value="cash">Espèces</option><option value="bank_transfer">Virement</option><option value="mobile_money">Mobile Money</option>
        </select>
      </FormField>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.paid} onChange={e=>u("paid",e.target.checked)} className="w-4 h-4 accent-cedar" />
        <span className="text-sm text-ink">Paiement reçu (génère le reçu)</span>
      </label>
      <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"…":"Enregistrer"}</button>
      </div>
    </form>
  );
}
