"use client";
import { useState, useEffect, useSyncExternalStore } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson } from "@/lib/api-client";
import { localDay, todayLocal } from "@/lib/format";
import { useFormDraft } from "@/lib/use-draft";
import { DraftBanner } from "@/components/ui/DraftBanner";
interface DevisLine { description: string; quantity: number; unitPrice: number; tvaRate: number; discount: number; totalHT: number; totalTVA: number; totalTTC: number; }
interface Client { _id: string; name: string; code: string; }
interface DevisFormProps { initial?: Record<string, unknown> & { _id?: string }; draftKey?: string; onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }

// Faux au rendu serveur et pendant l'hydratation (rien n'est affiché), vrai ensuite.
const noSubscribe = () => () => {};

function calcLine(l: Partial<DevisLine>): DevisLine {
  const qty = l.quantity || 0; const price = l.unitPrice || 0; const disc = l.discount || 0; const tva = l.tvaRate ?? TVA_TAUX_STANDARD;
  const ht = Math.round(qty * price * (1 - disc / 100)); const tvaAmt = calculerTVA(ht, tva);
  return { description: l.description || "", quantity: qty, unitPrice: price, tvaRate: tva, discount: disc, totalHT: ht, totalTVA: tvaAmt, totalTTC: ht + tvaAmt };
}

export function DevisForm({ initial, draftKey, onSave, onCancel }: DevisFormProps) {
  // Dates par défaut figées au montage (un rendu doit rester pur).
  const [{ today, in15 }] = useState(() => ({
    today: todayLocal(),
    in15: localDay(new Date(Date.now() + 15 * 86400000)),
  }));
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(String(initial?.clientId || ""));
  const [issueDate, setIssueDate] = useState(String(initial?.issueDate || today).slice(0, 10));
  const [validUntil, setValidUntil] = useState(String(initial?.validUntil || in15).slice(0, 10));
  const [notes, setNotes] = useState(String(initial?.notes || ""));
  const [lines, setLines] = useState<DevisLine[]>([calcLine({ description: "", quantity: 1, unitPrice: 0 })]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Saisie gardée sur l'appareil (déconnexion pour inactivité, rechargement…).
  const draft = useFormDraft(draftKey ?? null, { clientId, issueDate, validUntil, notes, lines });
  function restoreDraft() {
    const d = draft.restore();
    if (!d) return;
    setClientId(d.clientId); setIssueDate(d.issueDate); setValidUntil(d.validUntil); setNotes(d.notes);
    if (d.lines.length) setLines(d.lines.map(calcLine));
  }

  useEffect(() => { apiJson("/api/clients?picker=1&isActive=true").then(d=>setClients(d.data?.items||[])); }, []);

  if (!mounted) return null;

  function updateLine(i: number, field: keyof DevisLine, value: string | number) {
    setLines(prev => prev.map((l, idx) => idx === i ? calcLine({ ...l, [field]: value }) : l));
  }

  const totalHT = lines.reduce((s, l) => s + l.totalHT, 0);
  const totalTVA = lines.reduce((s, l) => s + l.totalTVA, 0);
  const totalTTC = totalHT + totalTVA;

  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setSaving(true); setError("");
      // Un refus du serveur s'affiche ; le bouton ne reste pas bloqué sur « Enregistrement… ».
      try { await onSave({ clientId, issueDate, validUntil, lines, notes, totalHT, totalTVA, totalTTC }); draft.clear(); }
      catch (err) { setError(err instanceof Error ? err.message : "Enregistrement impossible"); }
      finally { setSaving(false); }
    }} className="space-y-5">
      {draft.pending && <DraftBanner savedAt={draft.pending.savedAt} onRestore={restoreDraft} onDiscard={draft.discard} />}
      {error && <div className="p-3 bg-neg-50 border border-neg/25 rounded-lg text-neg text-sm">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FormField label="Client" required className="sm:col-span-1">
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
          <button type="button" onClick={()=>setLines(prev=>[...prev, calcLine({description:"",quantity:1,unitPrice:0})])} className="text-xs text-section hover:underline">+ Ligne</button>
        </div>
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-6 sm:grid-cols-12 gap-2 bg-surface2 p-2 rounded-lg">
            <input className={inputCls + " col-span-6 sm:col-span-4"} value={line.description} onChange={e=>updateLine(i,"description",e.target.value)} placeholder="Description" aria-label="Description" required />
            <input type="number" inputMode="decimal" className={inputCls + " col-span-2 sm:col-span-1"} value={line.quantity} onChange={e=>updateLine(i,"quantity",parseFloat(e.target.value)||0)} min={0} aria-label="Quantité" />
            <input type="number" inputMode="numeric" className={inputCls + " col-span-2 sm:col-span-2"} value={line.unitPrice} onChange={e=>updateLine(i,"unitPrice",parseFloat(e.target.value)||0)} min={0} placeholder="P.U." aria-label="Prix unitaire" />
            <select className={selectCls + " col-span-2 sm:col-span-2"} value={line.tvaRate} onChange={e=>updateLine(i,"tvaRate",parseFloat(e.target.value))} aria-label="TVA">
              <option value={0.19}>TVA 19%</option><option value={0.10}>TVA 10%</option><option value={0}>Exo.</option>
            </select>
            <div className="col-span-5 sm:col-span-2 flex items-center justify-end"><span className="font-mono text-sm font-bold">{line.totalTTC.toLocaleString("fr-FR")}</span></div>
            <button type="button" aria-label="Retirer la ligne" onClick={()=>lines.length>1&&setLines(p=>p.filter((_,j)=>j!==i))} className="col-span-1 text-ink2 hover:text-neg text-xl">×</button>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <div className="w-56 space-y-1.5 bg-surface2 rounded-xl p-3 text-sm">
          <div className="flex justify-between"><span className="text-ink2">HT</span><span className="font-mono">{totalHT.toLocaleString("fr-FR")} FCFA</span></div>
          <div className="flex justify-between"><span className="text-ink2">TVA</span><span className="font-mono">{totalTVA.toLocaleString("fr-FR")} FCFA</span></div>
          <div className="flex justify-between font-bold border-t border-line pt-1.5"><span>TTC</span><span className="font-mono text-section">{totalTTC.toLocaleString("fr-FR")} FCFA</span></div>
        </div>
      </div>

      <FormField label="Notes">
        <textarea className={inputCls + " resize-y"} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} />
      </FormField>

      <div className="flex justify-end gap-3 pt-3 border-t border-line">
        <button type="button" onClick={onCancel} className={buttonClass("secondary", "md")}>Annuler</button>
        <button type="submit" disabled={saving} className={buttonClass("primary", "md")}>{saving?"Enregistrement…":"Enregistrer le devis"}</button>
      </div>
    </form>
  );
}
