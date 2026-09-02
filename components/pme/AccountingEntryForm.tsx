"use client";
import { useState } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";

interface Line { accountCode: string; accountLabel: string; debit: number; credit: number; }
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

  const totalDebit = lines.reduce((s,l)=>s+l.debit,0);
  const totalCredit = lines.reduce((s,l)=>s+l.credit,0);
  
  // Validation : Équilibre + Tous les comptes remplis
  const balanced = Math.abs(totalDebit - totalCredit) <= 0.01 && totalDebit > 0;
  const allLinesFilled = lines.every(l => l.accountCode.trim() !== "" && l.accountLabel.trim() !== "");

  function updateLine(i: number, f: keyof Line, v: string|number) { 
    setLines(p=>p.map((l,j)=>j===i?{...l,[f]:v}:l)); 
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
      } catch (err: any) {
        setError(err.message || "Erreur serveur");
      } finally {
        setSaving(false);
      }
    }} className="space-y-4">
      
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-medium">{error}</div>}

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Journal" required><select className={selectCls} value={journalCode} onChange={e=>setJournalCode(e.target.value)}>{JOURNALS.map(([v,l])=><option key={v} value={v}>{v} — {l}</option>)}</select></FormField>
        <FormField label="Date" required><input type="date" className={inputCls} value={entryDate} onChange={e=>setEntryDate(e.target.value)} required /></FormField>
        <FormField label="Référence" required><input className={inputCls} value={reference} onChange={e=>setReference(e.target.value)} required /></FormField>
      </div>
      <FormField label="Libellé" required><input className={inputCls} value={label} onChange={e=>setLabel(e.target.value)} required /></FormField>
      
      <div>
        <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-moss px-2 pb-1">
          <span className="col-span-3">N° compte *</span>
          <span className="col-span-4">Libellé compte *</span>
          <span className="col-span-2 text-right">Débit</span>
          <span className="col-span-2 text-right">Crédit</span>
          <span className="col-span-1"></span>
        </div>
        
        {lines.map((l,i)=>(
          <div key={i} className="grid grid-cols-12 gap-2 mb-2">
            <input 
              className={`${inputCls} col-span-3 ${!l.accountCode && error ? 'border-red-400' : ''}`} 
              value={l.accountCode} 
              onChange={e=>updateLine(i,"accountCode",e.target.value)} 
              placeholder="Ex: 411000" 
              required 
            />
            <input 
              className={`${inputCls} col-span-4 ${!l.accountLabel && error ? 'border-red-400' : ''}`} 
              value={l.accountLabel} 
              onChange={e=>updateLine(i,"accountLabel",e.target.value)} 
              placeholder="Ex: Client" 
              required 
            />
            <input type="number" className={inputCls+" col-span-2 text-right"} value={l.debit} onChange={e=>updateLine(i,"debit",parseFloat(e.target.value)||0)} min={0} step="0.01" />
            <input type="number" className={inputCls+" col-span-2 text-right"} value={l.credit} onChange={e=>updateLine(i,"credit",parseFloat(e.target.value)||0)} min={0} step="0.01" />
            <button type="button" onClick={()=>lines.length>2&&setLines(p=>p.filter((_,j)=>j!==i))} className="text-moss hover:text-red-500 text-xl">×</button>
          </div>
        ))}

        <button type="button" onClick={()=>setLines(p=>[...p,{accountCode:"",accountLabel:"",debit:0,credit:0}])} className="text-xs font-bold text-cedar hover:underline mt-1">+ Ajouter une ligne</button>
        
        <div className="flex justify-end gap-8 mt-4 p-3 bg-sand/30 rounded-xl border border-clay/10 text-sm font-mono">
          <span className={totalDebit>0?"text-ink font-bold":"text-moss"}>Total Débits : {totalDebit.toLocaleString("fr-FR", {minimumFractionDigits: 2})}</span>
          <span className={totalCredit>0?"text-ink font-bold":"text-moss"}>Total Crédits : {totalCredit.toLocaleString("fr-FR", {minimumFractionDigits: 2})}</span>
          <span className={balanced && allLinesFilled ?"text-green-700 font-bold":"text-red-600 font-bold"}>
            {balanced && allLinesFilled ? "✅ Prêt à saisir" : !allLinesFilled ? "❌ Infos manquantes" : "❌ Déséquilibrée"}
          </span>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand transition-colors">Annuler</button>
        <button 
          type="submit" 
          disabled={saving || !balanced || !allLinesFilled} 
          className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          {saving ? "Enregistrement..." : "Saisir l'écriture"}
        </button>
      </div>
    </form>
  );
}