"use client";
import { useState } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";

interface ContractFormData {
  title: string; type: string; amount: number; paymentMode: string;
  isRecurring: boolean; billingFrequency: string; autoGenerateInvoice: boolean;
  startDate: string; endDate: string; signedDate: string;
  renewalReminderDays: number; status: string; description: string; notes: string;
}

const PAYMENT_MODES = [
  ["virement","Virement bancaire"],["cheque","Chèque"],
  ["tresor_public","Trésor public"],["tresor_prive","Trésor privé"],
  ["especes","Espèces"],["mobile_money","Mobile Money"],["autre","Autre"],
];
const FREQUENCIES = [
  ["one_time","Unique (non récurrent)"],["monthly","Mensuelle"],
  ["quarterly","Trimestrielle"],["biannual","Semestrielle"],["annual","Annuelle"],
];

interface ContractFormProps { initial?: Partial<ContractFormData> & { _id?: string }; onSave: (d: ContractFormData) => Promise<void>; onCancel: () => void; }

export function ContractForm({ initial, onSave, onCancel }: ContractFormProps) {
  const [form, setForm] = useState<ContractFormData>({
    title: initial?.title || "", type: initial?.type || "client",
    amount: initial?.amount ?? 0, paymentMode: initial?.paymentMode || "virement",
    isRecurring: initial?.isRecurring ?? false,
    billingFrequency: initial?.billingFrequency || "monthly",
    autoGenerateInvoice: initial?.autoGenerateInvoice ?? false,
    startDate: initial?.startDate?.slice(0,10) || "",
    endDate: initial?.endDate?.slice(0,10) || "",
    signedDate: initial?.signedDate?.slice(0,10) || "",
    renewalReminderDays: initial?.renewalReminderDays ?? 30,
    status: initial?.status || "draft",
    description: initial?.description || "", notes: initial?.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));

  return (
    <form onSubmit={async(e)=>{e.preventDefault();setSaving(true);await onSave(form);setSaving(false);}} className="space-y-5">

      {/* Identification */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">Identification</legend>
        <FormField label="Titre du contrat" required>
          <input className={inputCls} value={form.title} onChange={e=>u("title",e.target.value)} placeholder="Ex: Contrat de prestation IT 2025" required/>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Type" required>
            <select className={selectCls} value={form.type} onChange={e=>u("type",e.target.value)}>
              <option value="client">Client</option><option value="supplier">Fournisseur</option>
              <option value="employment">Emploi (CDI/CDD)</option><option value="freelance">Freelance / Consultant</option>
              <option value="other">Autre</option>
            </select>
          </FormField>
          <FormField label="Statut">
            <select className={selectCls} value={form.status} onChange={e=>u("status",e.target.value)}>
              <option value="draft">Brouillon</option><option value="active">Actif</option>
              <option value="suspended">Suspendu</option><option value="expired">Expiré</option>
            </select>
          </FormField>
        </div>
        <FormField label="Description"><textarea className={textareaCls} rows={2} value={form.description} onChange={e=>u("description",e.target.value)} placeholder="Objet du contrat..."/></FormField>
      </fieldset>

      {/* Financier */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">Conditions financières</legend>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Montant (XOF)">
            <input type="number" className={inputCls} value={form.amount} onChange={e=>u("amount",Number(e.target.value))} min={0}/>
          </FormField>
          <FormField label="Mode de paiement">
            <select className={selectCls} value={form.paymentMode} onChange={e=>u("paymentMode",e.target.value)}>
              {PAYMENT_MODES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </FormField>
        </div>
      </fieldset>

      {/* Récurrence */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">Récurrence</legend>
        <label className="flex items-center gap-3 cursor-pointer p-3 border border-clay/20 rounded-xl hover:border-cedar/30 transition-colors">
          <input type="checkbox" checked={form.isRecurring} onChange={e=>u("isRecurring",e.target.checked)} className="w-4 h-4 accent-cedar"/>
          <div>
            <span className="text-sm font-medium text-ink">Contrat récurrent</span>
            <p className="text-xs text-moss">Génération automatique de factures périodiques</p>
          </div>
        </label>
        {form.isRecurring && (
          <div className="space-y-3 pl-4 border-l-2 border-cedar/30">
            <FormField label="Fréquence de facturation">
              <select className={selectCls} value={form.billingFrequency} onChange={e=>u("billingFrequency",e.target.value)}>
                {FREQUENCIES.slice(1).map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.autoGenerateInvoice} onChange={e=>u("autoGenerateInvoice",e.target.checked)} className="w-4 h-4 accent-cedar"/>
              <span className="text-sm text-ink">Génération automatique des factures (via scheduler)</span>
            </label>
          </div>
        )}
      </fieldset>

      {/* Dates */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">Dates</legend>
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Date de début"><input type="date" className={inputCls} value={form.startDate} onChange={e=>u("startDate",e.target.value)}/></FormField>
          <FormField label="Date de fin" hint="Vide = durée illimitée"><input type="date" className={inputCls} value={form.endDate} onChange={e=>u("endDate",e.target.value)}/></FormField>
          <FormField label="Date de signature"><input type="date" className={inputCls} value={form.signedDate} onChange={e=>u("signedDate",e.target.value)}/></FormField>
        </div>
        <FormField label="Alerte renouvellement (jours avant fin)" hint="0 = désactivé">
          <input type="number" className={inputCls} value={form.renewalReminderDays} onChange={e=>u("renewalReminderDays",Number(e.target.value))} min={0}/>
        </FormField>
      </fieldset>

      <FormField label="Notes internes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e=>u("notes",e.target.value)}/></FormField>

      <div className="flex justify-end gap-3 pt-3 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">{saving?"Enregistrement…":"Enregistrer"}</button>
      </div>
    </form>
  );
}
