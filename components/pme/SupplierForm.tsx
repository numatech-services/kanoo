"use client";

import { useState } from "react";
import { FormField, inputCls } from "@/components/ui/FormField";

export interface SupplierFormData {
  code: string;
  name: string;
  nif?: string;
  phone?: string;
  email?: string;
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
    phone: initial?.phone || "",
    email: initial?.email || "",
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

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Téléphone">
          <input className={inputCls} value={form.phone}
            onChange={(e) => update("phone", e.target.value)} />
        </FormField>
        <FormField label="Email">
          <input type="email" className={inputCls} value={form.email}
            onChange={(e) => update("email", e.target.value)} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Délai de paiement (jours)">
          <input type="number" min={0} className={inputCls} value={form.paymentTermDays}
            onChange={(e) => update("paymentTermDays", Number(e.target.value))} />
        </FormField>
        <FormField label="Compte bancaire (RIB)">
          <input className={inputCls} value={form.bankAccount}
            onChange={(e) => update("bankAccount", e.target.value)} />
        </FormField>
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-clay/20">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm border border-clay/30 rounded-lg text-moss hover:bg-sand">
          Annuler
        </button>
        <button type="submit" disabled={saving}
          className="px-5 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink disabled:opacity-60">
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
