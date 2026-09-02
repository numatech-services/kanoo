"use client";
import { useState, useEffect } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";

interface DevisLine { description: string; quantity: number; unitPrice: number; tvaRate: number; discount: number; totalHT: number; totalTVA: number; totalTTC: number; }
interface Client { _id: string; name: string; code: string; }
interface DevisFormProps { initial?: Record<string, unknown> & { _id?: string }; onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }

function calcLine(l: Partial<DevisLine>): DevisLine {
  const qty = l.quantity || 0; const price = l.unitPrice || 0; const disc = l.discount || 0; const tva = l.tvaRate ?? TVA_TAUX_STANDARD;
  const ht = Math.round(qty * price * (1 - disc / 100)); const tvaAmt = calculerTVA(ht, tva);
  return { description: l.description || "", quantity: qty, unitPrice: price, tvaRate: tva, discount: disc, totalHT: ht, totalTVA: tvaAmt, totalTTC: ht + tvaAmt };
}

export function DevisForm({ initial, onSave, onCancel }: DevisFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const in15 = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const [mounted, setMounted] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(String(initial?.clientId || ""));
  const [issueDate, setIssueDate] = useState(String(initial?.issueDate || today).slice(0, 10));
  const [validUntil, setValidUntil] = useState(String(initial?.validUntil || in15).slice(0, 10));
  const [notes, setNotes] = useState(String(initial?.notes || ""));
  const [lines, setLines] = useState<DevisLine[]>([calcLine({ description: "", quantity: 1, unitPrice: 0 })]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setMounted(true); fetch("/api/clients?limit=100&isActive=true",{credentials:"include"}).then(r=>r.json()).then(d=>setClients(d.data?.items||[])); }, []);

  if (!mounted) return null;

  function updateLine(i: number, field: keyof DevisLine, value: string | number) {
    setLines(prev => prev.map((l, idx) => idx === i ? calcLine({ ...l, [field]: value }) : l));
  }

  const totalHT = lines.reduce((s, l) => s + l.totalHT, 0);
  const totalTVA = lines.reduce((s, l) => s + l.totalTVA, 0);
  const totalTTC = totalHT + totalTVA;

  return (
    <form onSubmit={async (e) => { e.preventDefault(); setSaving(true); await onSave({ clientId, issueDate, validUntil, lines, notes, totalHT, totalTVA, totalTTC }); setSaving(false); }} className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <FormField label="Client" required className="col-span-1">
          <select className={selectCls} value={clientId} onChange={e=>setClientId(e.target.value)} required>
            <option value="">Choisir…</option>
            {clients.map(c=><option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Date émission" required>
          <input type="date" className={inputCls} value={issueDate} onChange={e=>setIssueDate(e.target.value)} required />
        </FormField>
        <FormField label="Valide jusqu'au" required>
          <input type="date" className={inputCls} value={validUntil} onChange={e=>setValidUntil(e.target.value)} required />
        </FormField>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <p className="text-sm font-semibold text-ink">Lignes</p>
          <button type="button" onClick={()=>setLines(prev=>[...prev, calcLine({description:"",quantity:1,unitPrice:0})])} className="text-xs text-cedar hover:underline">+ Ligne</button>
        </div>
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 bg-sand p-2 rounded-lg">
            <input className={inputCls + " col-span-4"} value={line.description} onChange={e=>updateLine(i,"description",e.target.value)} placeholder="Description" required />
            <input type="number" className={inputCls + " col-span-1"} value={line.quantity} onChange={e=>updateLine(i,"quantity",parseFloat(e.target.value)||0)} min={0} />
            <input type="number" className={inputCls + " col-span-2"} value={line.unitPrice} onChange={e=>updateLine(i,"unitPrice",parseFloat(e.target.value)||0)} min={0} placeholder="P.U." />
            <select className={selectCls + " col-span-2"} value={line.tvaRate} onChange={e=>updateLine(i,"tvaRate",parseFloat(e.target.value))}>
              <option value={0.19}>TVA 19%</option><option value={0.10}>TVA 10%</option><option value={0}>Exo.</option>
            </select>
            <div className="col-span-2 flex items-center justify-end"><span className="font-mono text-sm font-bold">{line.totalTTC.toLocaleString("fr-FR")}</span></div>
            <button type="button" onClick={()=>lines.length>1&&setLines(p=>p.filter((_,j)=>j!==i))} className="col-span-1 text-moss hover:text-red-500 text-xl">×</button>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <div className="w-56 space-y-1.5 bg-sand rounded-xl p-3 text-sm">
          <div className="flex justify-between"><span className="text-moss">HT</span><span className="font-mono">{totalHT.toLocaleString("fr-FR")} XOF</span></div>
          <div className="flex justify-between"><span className="text-moss">TVA</span><span className="font-mono">{totalTVA.toLocaleString("fr-FR")} XOF</span></div>
          <div className="flex justify-between font-bold border-t border-clay/20 pt-1.5"><span>TTC</span><span className="font-mono text-cedar">{totalTTC.toLocaleString("fr-FR")} XOF</span></div>
        </div>
      </div>

      <FormField label="Notes">
        <textarea className={inputCls + " resize-y"} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} />
      </FormField>

      <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"Enregistrement…":"Enregistrer le devis"}</button>
      </div>
    </form>
  );
}
