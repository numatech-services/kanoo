"use client";

import { useState } from "react";
import { FormField, inputCls, textareaCls } from "@/components/ui/FormField";
import { LogoPicker } from "@/components/ui/LogoPicker";

export interface SupplierFormData {
  code: string;
  name: string;
  nif?: string;
  rccm?: string;
  phone?: string;
  email?: string;
  address?: string;
  logo?: string;
  notes?: string;
  paymentTermDays: number;
  bankAccount?: string;
  isActive: boolean;
}

interface SupplierFormProps {
  initial?: Partial<SupplierFormData>;
  onSave: (data: SupplierFormData) => Promise<void>;
  onCancel: () => void;
}

/**
 * Formulaire fournisseur, partagé entre la liste et la fiche détaillée.
 *
 * Il vivait à l'intérieur de la page de liste : la fiche détaillée avait bien
 * un bouton « Modifier », mais aucun formulaire à afficher — le bouton était
 * inerte.
 */
export function SupplierForm({ initial, onSave, onCancel }: SupplierFormProps) {
  const [form, setForm] = useState<SupplierFormData>({
    code: initial?.code || "",
    name: initial?.name || "",
    nif: initial?.nif || "",
    rccm: initial?.rccm || "",
    phone: initial?.phone || "",
    email: initial?.email || "",
    address: initial?.address || "",
    logo: initial?.logo || "",
    notes: initial?.notes || "",
    paymentTermDays: initial?.paymentTermDays ?? 30,
    bankAccount: initial?.bankAccount || "",
    isActive: initial?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof SupplierFormData>(field: K, value: SupplierFormData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      // L'échec était silencieux : la modale se fermait comme si tout allait bien.
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="px-3 py-2 bg-neg-50 border border-neg/25 rounded-lg text-sm text-neg">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Code" required>
          <input className={inputCls} value={form.code}
            onChange={(e) => update("code", e.target.value)} required />
        </FormField>
        <FormField label="NIF">
          <input className={inputCls} value={form.nif}
            onChange={(e) => update("nif", e.target.value)} />
        </FormField>
      </div>

      <FormField label="Nom / Raison sociale" required>
        <input className={inputCls} value={form.name}
          onChange={(e) => update("name", e.target.value)} required />
      </FormField>

      <LogoPicker value={form.logo} onChange={(v) => update("logo", v)} label="Logo du fournisseur" />

      <div className="grid grid-cols-2 gap-4">
        <FormField label="RCCM">
          <input className={inputCls} value={form.rccm}
            onChange={(e) => update("rccm", e.target.value)} />
        </FormField>
        <FormField label="Téléphone">
          <input className={inputCls} value={form.phone}
            onChange={(e) => update("phone", e.target.value)} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Email">
          <input type="email" className={inputCls} value={form.email}
            onChange={(e) => update("email", e.target.value)} />
        </FormField>
        <FormField label="Délai de paiement (jours)">
          <input type="number" min={0} className={inputCls} value={form.paymentTermDays}
            onChange={(e) => update("paymentTermDays", Number(e.target.value))} />
        </FormField>
      </div>

      <FormField label="Adresse">
        <textarea className={textareaCls} rows={2} value={form.address}
          onChange={(e) => update("address", e.target.value)} />
      </FormField>

      <FormField label="Compte bancaire (RIB)">
        <input className={inputCls} value={form.bankAccount}
          onChange={(e) => update("bankAccount", e.target.value)} />
      </FormField>

      <FormField label="Notes internes">
        <textarea className={textareaCls} rows={2} value={form.notes}
          onChange={(e) => update("notes", e.target.value)} />
      </FormField>

      <div className="flex justify-end gap-3 pt-2 border-t border-line">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm border border-line rounded-lg text-ink2 hover:bg-surface2">
          Annuler
        </button>
        <button type="submit" disabled={saving}
          className="px-5 py-2 bg-section text-white rounded-lg text-sm font-medium hover:brightness-95 disabled:opacity-60">
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
