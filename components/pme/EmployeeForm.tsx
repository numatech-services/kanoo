"use client";
import { useState } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { COST_CENTERS } from "@/lib/cost-centers";

import { buttonClass } from "@/components/ui/button-class";
export interface EmployeeFormData {
  code: string; firstName: string; lastName: string; position: string; department: string; costCenter?: string;
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

/**
 * `payroll = false` : le compte gère le dossier (identité, contrat, poste) sans
 * accès à la paie — la rémunération et le RIB ne sont ni affichés ni envoyés.
 */
export function EmployeeForm({ initial, onSave, onCancel, payroll = true }: { initial?: Partial<EmployeeFormData> & { _id?: string }; onSave: (d: EmployeeFormData) => Promise<void>; onCancel: () => void; payroll?: boolean; }) {
  const [form, setForm] = useState<EmployeeFormData>({
    code: initial?.code||"", firstName: initial?.firstName||"", lastName: initial?.lastName||"",
    position: initial?.position||"", department: initial?.department||"", costCenter: initial?.costCenter||"",
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
    if (payroll && isEmployee && form.grossSalary <= 0) return setError("Le salaire brut est requis");
    if (payroll && (isIntern || isFreelance) && form.indemnity <= 0) return setError("L'indemnité est requise");
    setError(""); setSaving(true);
    const PAYROLL_KEYS = ["grossSalary", "indemnity", "indemnityPeriod", "otherDeductionLabel", "otherDeductionAmount", "bankAccount", "bankName", "includeCnss", "includeIr"];
    const body = payroll ? form : Object.fromEntries(Object.entries(form).filter(([k]) => !PAYROLL_KEYS.includes(k))) as unknown as EmployeeFormData;
    try { await onSave(body); } catch (err: unknown) { setError(err instanceof Error ? err.message : "Erreur"); }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="p-3 bg-neg-50 border border-neg/25 rounded-lg text-neg text-sm">{error}</div>}

      {/* Type */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink border-b border-line pb-2 w-full">Type de collaborateur</legend>
        <div className="grid grid-cols-3 gap-3">
          {TYPE_OPTIONS.map(([v,l]) => (
            <label key={v} className={`flex items-center gap-2 p-3 border-2 rounded-xl cursor-pointer transition-all ${form.employeeType===v?"border-section bg-section/5":"border-line hover:border-section/30"}`}>
              <input type="radio" name="employeeType" value={v} checked={form.employeeType===v} onChange={()=>u("employeeType",v)} className="accent-section"/>
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
        <legend className="text-sm font-semibold text-ink border-b border-line pb-2 w-full">Identité</legend>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Code" required><input className={inputCls} value={form.code} onChange={e=>u("code",e.target.value)} placeholder="EMP-001" required/></FormField>
          <FormField label="Service" hint="Centre de coût : la paie y est imputée">
            <select className={selectCls} value={form.costCenter} onChange={e=>u("costCenter",e.target.value)}>
              <option value="">—</option>
              {Object.entries(COST_CENTERS).map(([k,l])=><option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Prénom" required><input className={inputCls} value={form.firstName} onChange={e=>u("firstName",e.target.value)} required/></FormField>
          <FormField label="Nom" required><input className={inputCls} value={form.lastName} onChange={e=>u("lastName",e.target.value)} required/></FormField>
        </div>
        <FormField label="Département / équipe"><input className={inputCls} value={form.department} onChange={e=>u("department",e.target.value)}/></FormField>
        <FormField label="Poste / Fonction" required><input className={inputCls} value={form.position} onChange={e=>u("position",e.target.value)} required/></FormField>
      </fieldset>

      {/* Rémunération — réservée à la paie (chef comptable, gérant) */}
      {payroll && <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-line pb-2 w-full">
          Rémunération {isEmployee?"(salarié)":isIntern?"(stagiaire)":"(freelance)"}
        </legend>
        {isEmployee ? (
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Salaire brut (FCFA)" required hint="Base calcul CNSS">
              <input type="number" className={inputCls} value={form.grossSalary} onChange={e=>u("grossSalary",Number(e.target.value))} min={0} required/>
            </FormField>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.includeCnss} onChange={e=>u("includeCnss",e.target.checked)} className="accent-section"/><span>Inclure CNSS (3,6% + 16,4%)</span></label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.includeIr} onChange={e=>u("includeIr",e.target.checked)} className="accent-section"/><span>Inclure IR (impôt revenu)</span></label>
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
          <FormField label="Montant retenue (FCFA)"><input type="number" className={inputCls} value={form.otherDeductionAmount} onChange={e=>u("otherDeductionAmount",Number(e.target.value))} min={0}/></FormField>
        </div>

        {/* Simulation paie */}
        {(isEmployee ? form.grossSalary : form.indemnity) > 0 && (
          <div className="bg-info-50 border border-info/25 rounded-xl p-3 grid grid-cols-4 gap-3 text-xs">
            {isEmployee && form.includeCnss && <>
              <div className="text-center"><p className="font-semibold text-info">{cnssEmployee.toLocaleString("fr-FR")} FCFA</p><p className="text-info mt-0.5">CNSS salarié</p></div>
              <div className="text-center"><p className="font-semibold text-info">{cnssEmployer.toLocaleString("fr-FR")} FCFA</p><p className="text-info mt-0.5">CNSS patronal</p></div>
            </>}
            {form.otherDeductionAmount > 0 && <div className="text-center"><p className="font-semibold text-warn">{form.otherDeductionAmount.toLocaleString("fr-FR")} FCFA</p><p className="text-warn mt-0.5">Autre retenue</p></div>}
            <div className="text-center"><p className="font-bold text-pos">{Math.max(0,netSalary).toLocaleString("fr-FR")} FCFA</p><p className="text-pos mt-0.5">{isEmployee?"Net avant IR (estimation)":"Montant net"}</p></div>
          </div>
        )}
      </fieldset>}

      {/* Dates */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-line pb-2 w-full">Dates</legend>
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Date d'entrée" required><input type="date" className={inputCls} value={form.startDate} onChange={e=>u("startDate",e.target.value)} required/></FormField>
          <FormField label="Date de fin prévue" hint="CDI = laisser vide"><input type="date" className={inputCls} value={form.endDate} onChange={e=>u("endDate",e.target.value)}/></FormField>
          <FormField label="Fin de contrat (alerte)" hint="Déclenche une alerte 30j avant"><input type="date" className={inputCls} value={form.contractEndDate} onChange={e=>u("contractEndDate",e.target.value)}/></FormField>
        </div>
      </fieldset>

      {/* Coordonnées */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-line pb-2 w-full">Coordonnées officielles</legend>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="N° CNSS"><input className={inputCls} value={form.cnssNumber} onChange={e=>u("cnssNumber",e.target.value)}/></FormField>
          <FormField label="NIF"><input className={inputCls} value={form.nif} onChange={e=>u("nif",e.target.value)}/></FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Téléphone"><input className={inputCls} value={form.phone} onChange={e=>u("phone",e.target.value)}/></FormField>
          <FormField label="Email"><input type="email" className={inputCls} value={form.email} onChange={e=>u("email",e.target.value)}/></FormField>
        </div>
        {payroll && <div className="grid grid-cols-2 gap-4">
          <FormField label="Banque"><input className={inputCls} value={form.bankName} onChange={e=>u("bankName",e.target.value)}/></FormField>
          <FormField label="RIB / Compte bancaire"><input className={inputCls} value={form.bankAccount} onChange={e=>u("bankAccount",e.target.value)}/></FormField>
        </div>}
      </fieldset>

      <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e=>u("notes",e.target.value)}/></FormField>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.isActive} onChange={e=>u("isActive",e.target.checked)} className="w-4 h-4 accent-section"/>
        <span className="text-sm text-ink">Collaborateur actif</span>
      </label>

      <div className="flex justify-end gap-3 pt-4 border-t border-line">
        <button type="button" onClick={onCancel} className={buttonClass("secondary", "md")}>Annuler</button>
        <button type="submit" disabled={saving} className={buttonClass("primary", "md")}>
          {saving?"Enregistrement…":"Enregistrer"}
        </button>
      </div>
    </form>
  );
}
