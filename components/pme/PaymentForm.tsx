"use client";
import { useState } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
interface PaymentFormProps { invoiceId: string; remainingAmount: number; onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }
export function PaymentForm({ invoiceId, remainingAmount, onSave, onCancel }: PaymentFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(remainingAmount);
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const methods = [["bank_transfer","Virement bancaire"],["cash","Espèces"],["cheque","Chèque"],["mobile_money","Mobile Money"],["other","Autre"]];
  return (
    <form onSubmit={async(e)=>{e.preventDefault();if(amount<=0||amount>remainingAmount+1){setError(`Montant entre 1 et ${remainingAmount.toLocaleString("fr-FR")} XOF`);return;}setSaving(true);setError("");await onSave({invoiceId,amount,method,reference,date,notes});setSaving(false);}} className="space-y-4">
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm"><span className="font-semibold text-amber-800">Reste à payer : </span><span className="font-mono font-bold text-amber-900">{remainingAmount.toLocaleString("fr-FR")} XOF</span></div>
      <FormField label="Montant encaissé (XOF)" required>
        <input type="number" className={inputCls} value={amount} onChange={e=>setAmount(parseFloat(e.target.value)||0)} min={1} max={remainingAmount} required />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Mode de paiement" required>
          <select className={selectCls} value={method} onChange={e=>setMethod(e.target.value)}>{methods.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        </FormField>
        <FormField label="Date de réception" required>
          <input type="date" className={inputCls} value={date} onChange={e=>setDate(e.target.value)} required />
        </FormField>
      </div>
      <FormField label="Référence (n° virement, chèque…)"><input className={inputCls} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Optionnel" /></FormField>
      <FormField label="Notes"><textarea className={inputCls+" resize-y"} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} /></FormField>
      <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-6 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-60">{saving?"Enregistrement…":"Enregistrer le paiement"}</button>
      </div>
    </form>
  );
}
