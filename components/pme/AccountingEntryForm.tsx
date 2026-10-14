"use client";
import { useEffect, useState } from "react";
import { ImputationFields, type ImputationValue } from "@/components/shared/ImputationFields";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { errorMessage } from "@/lib/errors";

import { buttonClass } from "@/components/ui/button-class";
interface Line extends ImputationValue { accountCode: string; accountLabel: string; debit: number; credit: number; }
interface AccountingEntryFormProps { onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void; }

const JOURNALS = [["AC","Achats"],["VT","Ventes"],["BQ","Banque"],["CA","Caisse"],["OD","Opérations Diverses"]];

export function AccountingEntryForm({ onSave, onCancel }: AccountingEntryFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [journalCode, setJournalCode] = useState("OD");
  const [entryDate, setEntryDate] = useState(today);
  const [reference, setReference] = useState("");
  const [label, setLabel] = useState("");
  const [lines, setLines] = useState<Line[]>([
    {accountCode:"", accountLabel:"", debit:0, credit:0},
    {accountCode:"", accountLabel:"", debit:0, credit:0}
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Plan comptable : autocomplétion du numéro, intitulé rempli d'office.
  const [plan, setPlan] = useState<Array<{ code: string; label: string }>>([]);
  useEffect(() => {
    fetch("/api/ledger-accounts", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => d?.data && setPlan(d.data)).catch(() => {});
  }, []);

  const totalDebit = lines.reduce((s,l)=>s+l.debit,0);
  const totalCredit = lines.reduce((s,l)=>s+l.credit,0);
  
  // Validation : Équilibre + Tous les comptes remplis
  const balanced = Math.abs(totalDebit - totalCredit) <= 0.01 && totalDebit > 0;
  const allLinesFilled = lines.every(l => l.accountCode.trim() !== "" && l.accountLabel.trim() !== "");

  function updateLine(i: number, f: keyof Line, v: string|number) {
    setLines(p=>p.map((l,j)=>{
      if (j!==i) return l;
      const next = {...l,[f]:v} as Line;
      // Débit OU crédit sur une ligne.
      if (f === "debit" && Number(v) > 0) next.credit = 0;
      if (f === "credit" && Number(v) > 0) next.debit = 0;
      if (f === "accountCode") { const a = plan.find(x => x.code === String(v).trim()); if (a) next.accountLabel = a.label; }
      return next;
    }));
  }

  return (
    <form onSubmit={async(e)=>{
      e.preventDefault();
      if(!allLinesFilled){
        setError("Veuillez remplir le numéro et le libellé de compte pour chaque ligne.");
        return;
      }
      if(!balanced){
        setError(`Écriture déséquilibrée ou vide : débits ${totalDebit} ≠ crédits ${totalCredit}`);
        return;
      }
      setSaving(true);
      setError("");
      try {
        await onSave({journalCode, entryDate, reference, label, lines});
      } catch (err) {
        setError(errorMessage(err) || "Erreur serveur");
      } finally {
        setSaving(false);
      }
    }} className="space-y-4">
      
      {error && <div className="p-3 bg-neg-50 border border-neg/25 rounded-lg text-neg text-sm font-medium">{error}</div>}

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Journal" required><select className={selectCls} value={journalCode} onChange={e=>setJournalCode(e.target.value)}>{JOURNALS.map(([v,l])=><option key={v} value={v}>{v} — {l}</option>)}</select></FormField>
        <FormField label="Date" required><input type="date" className={inputCls} value={entryDate} onChange={e=>setEntryDate(e.target.value)} required /></FormField>
        <FormField label="Référence" required><input className={inputCls} value={reference} onChange={e=>setReference(e.target.value)} required /></FormField>
      </div>
      <FormField label="Libellé" required><input className={inputCls} value={label} onChange={e=>setLabel(e.target.value)} required /></FormField>
      
      <div>
        <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-ink2 px-2 pb-1">
          <span className="col-span-3">N° compte *</span>
          <span className="col-span-4">Libellé compte *</span>
          <span className="col-span-2 text-right">Débit</span>
          <span className="col-span-2 text-right">Crédit</span>
          <span className="col-span-1"></span>
        </div>
        
        {lines.map((l,i)=>(
          <div key={i} className="grid grid-cols-12 gap-2 mb-2">
            <input 
              className={`${inputCls} col-span-3 ${!l.accountCode && error ? 'border-neg/25' : ''}`} 
              value={l.accountCode} 
              onChange={e=>updateLine(i,"accountCode",e.target.value)} 
              placeholder="Ex: 411000" 
              list="plan-comptable"
              required 
            />
            <input 
              className={`${inputCls} col-span-4 ${!l.accountLabel && error ? 'border-neg/25' : ''}`} 
              value={l.accountLabel} 
              onChange={e=>updateLine(i,"accountLabel",e.target.value)} 
              placeholder="Ex: Client" 
              required 
            />
            <input type="number" className={inputCls+" col-span-2 text-right"} value={l.debit} onChange={e=>updateLine(i,"debit",parseFloat(e.target.value)||0)} min={0} step="0.01" />
            <input type="number" className={inputCls+" col-span-2 text-right"} value={l.credit} onChange={e=>updateLine(i,"credit",parseFloat(e.target.value)||0)} min={0} step="0.01" />
            <button type="button" onClick={()=>lines.length>2&&setLines(p=>p.filter((_,j)=>j!==i))} className="text-ink2 hover:text-neg text-xl">×</button>
            {/^[67]/.test(l.accountCode) && (
              <div className="col-span-12 pl-2">
                <ImputationFields compact value={l} onChange={v => setLines(p => p.map((x, j) => j === i ? { ...x, ...v } : x))} />
              </div>
            )}
          </div>
        ))}
        <datalist id="plan-comptable">
          {plan.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
        </datalist>

        <button type="button" onClick={()=>setLines(p=>[...p,{accountCode:"",accountLabel:"",debit:0,credit:0}])} className="text-xs font-bold text-section hover:underline mt-1">+ Ajouter une ligne</button>
        
        <div className="flex justify-end gap-8 mt-4 p-3 bg-surface2/30 rounded-xl border border-line text-sm font-mono">
          <span className={totalDebit>0?"text-ink font-bold":"text-ink2"}>Total Débits : {totalDebit.toLocaleString("fr-FR", {minimumFractionDigits: 2})}</span>
          <span className={totalCredit>0?"text-ink font-bold":"text-ink2"}>Total Crédits : {totalCredit.toLocaleString("fr-FR", {minimumFractionDigits: 2})}</span>
          <span className={balanced && allLinesFilled ?"text-pos font-bold":"text-neg font-bold"}>
            {balanced && allLinesFilled ? "Prêt à saisir" : !allLinesFilled ? "Infos manquantes" : "Déséquilibrée"}
          </span>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-line">
        <button type="button" onClick={onCancel} className={buttonClass("secondary", "md")}>Annuler</button>
        <button 
          type="submit" 
          disabled={saving || !balanced || !allLinesFilled} 
          className={buttonClass("primary", "md")}
        >
          {saving ? "Enregistrement..." : "Saisir l'écriture"}
        </button>
      </div>
    </form>
  );
}