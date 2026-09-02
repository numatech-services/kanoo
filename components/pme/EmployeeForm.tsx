"use client";
import { useState } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";

interface EmployeeFormData {
  code: string; firstName: string; lastName: string; position: string; department: string;
  employeeType: string; contractNature: string;
  grossSalary: number; indemnity: number; indemnityPeriod: string;
  startDate: string; endDate: string; contractEndDate: string;
  cnssNumber: string; nif: string; phone: string; email: string; bankAccount: string; bankName: string;
  includeCnss: boolean; includeIr: boolean;
  otherDeductionLabel: string; otherDeductionAmount: number;
  isActive: boolean; notes: string;
}

const TYPE_OPTIONS = [["employee","Employé (salarié)"],["intern","Stagiaire"],["freelance","Freelance / Consultant"]];
const CONTRACT_OPTIONS = [["cdi","CDI"],["cdd","CDD"],["stage","Convention de stage"],["freelance","Contrat freelance"],["consultant","Contrat consultant"]];
const PERIOD_OPTIONS = [["monthly","par mois"],["daily","par jour"],["hourly","par heure"],["fixed","forfait"]];

export function EmployeeForm({ initial, onSave, onCancel }: { initial?: Partial<EmployeeFormData> & { _id?: string }; onSave: (d: EmployeeFormData) => Promise<void>; onCancel: () => void; }) {
  const [form, setForm] = useState<EmployeeFormData>({
    code: initial?.code||"", firstName: initial?.firstName||"", lastName: initial?.lastName||"",
    position: initial?.position||"", department: initial?.department||"",
    employeeType: initial?.employeeType||"employee", contractNature: initial?.contractNature||"cdi",
    grossSalary: initial?.grossSalary??0, indemnity: initial?.indemnity??0,
    indemnityPeriod: initial?.indemnityPeriod||"monthly",
    startDate: initial?.startDate?.slice(0,10)||"",
    endDate: initial?.endDate?.slice(0,10)||"",
    contractEndDate: initial?.contractEndDate?.slice(0,10)||"",
    cnssNumber: initial?.cnssNumber||"", nif: initial?.nif||"",
    phone: initial?.phone||"", email: initial?.email||"",
    bankAccount: initial?.bankAccount||"", bankName: initial?.bankName||"",
    includeCnss: initial?.includeCnss??true, includeIr: initial?.includeIr??true,
    otherDeductionLabel: initial?.otherDeductionLabel||"",
    otherDeductionAmount: initial?.otherDeductionAmount??0,
    isActive: initial?.isActive??true, notes: initial?.notes||"",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));

  const isEmployee = form.employeeType === "employee";
  const isIntern = form.employeeType === "intern";
  const isFreelance = form.employeeType === "freelance";

  // Calculs paie
  const cnssEmployee = isEmployee && form.includeCnss ? Math.round(form.grossSalary * 0.036) : 0;
  const cnssEmployer = isEmployee && form.includeCnss ? Math.round(form.grossSalary * 0.164) : 0;
  const netSalary = isEmployee
    ? form.grossSalary - cnssEmployee - form.otherDeductionAmount
    : form.indemnity - form.otherDeductionAmount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code || !form.firstName || !form.lastName || !form.position || !form.startDate) {
      return setError("Les champs Code, Prénom, Nom, Poste et Date d'entrée sont obligatoires");
    }
    if (isEmployee && form.grossSalary <= 0) return setError("Le salaire brut est requis");
    if ((isIntern || isFreelance) && form.indemnity <= 0) return setError("L'indemnité est requise");
    setError(""); setSaving(true);
    try { await onSave(form); } catch (err: unknown) { setError(err instanceof Error ? err.message : "Erreur"); }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      {/* Type */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">Type de collaborateur</legend>
        <div className="grid grid-cols-3 gap-3">
          {TYPE_OPTIONS.map(([v,l]) => (
            <label key={v} className={`flex items-center gap-2 p-3 border-2 rounded-xl cursor-pointer transition-all ${form.employeeType===v?"border-cedar bg-cedar/5":"border-clay/20 hover:border-cedar/30"}`}>
              <input type="radio" name="employeeType" value={v} checked={form.employeeType===v} onChange={()=>u("employeeType",v)} className="accent-cedar"/>
              <span className="text-sm font-medium">{l}</span>
            </label>
          ))}
        </div>
        <FormField label="Nature du contrat">
          <select className={selectCls} value={form.contractNature} onChange={e=>u("contractNature",e.target.value)}>
            {CONTRACT_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
        </FormField>
      </fieldset>

      {/* Identité */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">Identité</legend>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Code" required><input className={inputCls} value={form.code} onChange={e=>u("code",e.target.value)} placeholder="EMP-001" required/></FormField>
          <FormField label="Département"><input className={inputCls} value={form.department} onChange={e=>u("department",e.target.value)}/></FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Prénom" required><input className={inputCls} value={form.firstName} onChange={e=>u("firstName",e.target.value)} required/></FormField>
          <FormField label="Nom" required><input className={inputCls} value={form.lastName} onChange={e=>u("lastName",e.target.value)} required/></FormField>
        </div>
        <FormField label="Poste / Fonction" required><input className={inputCls} value={form.position} onChange={e=>u("position",e.target.value)} required/></FormField>
      </fieldset>

      {/* Rémunération */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">
          Rémunération {isEmployee?"(salarié)":isIntern?"(stagiaire)":"(freelance)"}
        </legend>
        {isEmployee ? (
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Salaire brut (XOF)" required hint="Base calcul CNSS">
              <input type="number" className={inputCls} value={form.grossSalary} onChange={e=>u("grossSalary",Number(e.target.value))} min={0} required/>
            </FormField>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.includeCnss} onChange={e=>u("includeCnss",e.target.checked)} className="accent-cedar"/><span>Inclure CNSS (3,6% + 16,4%)</span></label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.includeIr} onChange={e=>u("includeIr",e.target.checked)} className="accent-cedar"/><span>Inclure IR (impôt revenu)</span></label>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <FormField label={isIntern?"Indemnité de stage":"Honoraires / Tarif"} required>
              <input type="number" className={inputCls} value={form.indemnity} onChange={e=>u("indemnity",Number(e.target.value))} min={0} required/>
            </FormField>
            <FormField label="Périodicité">
              <select className={selectCls} value={form.indemnityPeriod} onChange={e=>u("indemnityPeriod",e.target.value)}>
                {PERIOD_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Libellé autre retenue"><input className={inputCls} value={form.otherDeductionLabel} onChange={e=>u("otherDeductionLabel",e.target.value)} placeholder="Ex: Avance sur salaire"/></FormField>
          <FormField label="Montant retenue (XOF)"><input type="number" className={inputCls} value={form.otherDeductionAmount} onChange={e=>u("otherDeductionAmount",Number(e.target.value))} min={0}/></FormField>
        </div>

        {/* Simulation paie */}
        {(isEmployee ? form.grossSalary : form.indemnity) > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 grid grid-cols-4 gap-3 text-xs">
            {isEmployee && form.includeCnss && <>
              <div className="text-center"><p className="font-semibold text-blue-800">{cnssEmployee.toLocaleString("fr-FR")} XOF</p><p className="text-blue-600 mt-0.5">CNSS salarié</p></div>
              <div className="text-center"><p className="font-semibold text-blue-800">{cnssEmployer.toLocaleString("fr-FR")} XOF</p><p className="text-blue-600 mt-0.5">CNSS patronal</p></div>
            </>}
            {form.otherDeductionAmount > 0 && <div className="text-center"><p className="font-semibold text-amber-800">{form.otherDeductionAmount.toLocaleString("fr-FR")} XOF</p><p className="text-amber-600 mt-0.5">Autre retenue</p></div>}
            <div className="text-center"><p className="font-bold text-green-800">{Math.max(0,netSalary).toLocaleString("fr-FR")} XOF</p><p className="text-green-600 mt-0.5">{isEmployee?"Net estimé":"Montant net"}</p></div>
          </div>
        )}
      </fieldset>

      {/* Dates */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">Dates</legend>
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Date d'entrée" required><input type="date" className={inputCls} value={form.startDate} onChange={e=>u("startDate",e.target.value)} required/></FormField>
          <FormField label="Date de fin prévue" hint="CDI = laisser vide"><input type="date" className={inputCls} value={form.endDate} onChange={e=>u("endDate",e.target.value)}/></FormField>
          <FormField label="Fin de contrat (alerte)" hint="Déclenche une alerte 30j avant"><input type="date" className={inputCls} value={form.contractEndDate} onChange={e=>u("contractEndDate",e.target.value)}/></FormField>
        </div>
      </fieldset>

      {/* Coordonnées */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">Coordonnées officielles</legend>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="N° CNSS"><input className={inputCls} value={form.cnssNumber} onChange={e=>u("cnssNumber",e.target.value)}/></FormField>
          <FormField label="NIF"><input className={inputCls} value={form.nif} onChange={e=>u("nif",e.target.value)}/></FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Téléphone"><input className={inputCls} value={form.phone} onChange={e=>u("phone",e.target.value)}/></FormField>
          <FormField label="Email"><input type="email" className={inputCls} value={form.email} onChange={e=>u("email",e.target.value)}/></FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Banque"><input className={inputCls} value={form.bankName} onChange={e=>u("bankName",e.target.value)}/></FormField>
          <FormField label="RIB / Compte bancaire"><input className={inputCls} value={form.bankAccount} onChange={e=>u("bankAccount",e.target.value)}/></FormField>
        </div>
      </fieldset>

      <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e=>u("notes",e.target.value)}/></FormField>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.isActive} onChange={e=>u("isActive",e.target.checked)} className="w-4 h-4 accent-cedar"/>
        <span className="text-sm text-ink">Collaborateur actif</span>
      </label>

      <div className="flex justify-end gap-3 pt-4 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-5 py-2.5 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand">Annuler</button>
        <button type="submit" disabled={saving} className="px-6 py-2.5 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">
          {saving?"Enregistrement…":"Enregistrer"}
        </button>
      </div>
    </form>
  );
}
