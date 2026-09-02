"use client";

import { useState } from "react";

interface ClientFormData {
  code: string;
  name: string;
  type: "individual" | "company";
  nif?: string;
  rccm?: string;
  email?: string;
  phone?: string;
  address?: string;
  creditLimit: number;
  paymentTermDays: number;
  isActive: boolean;
  notes?: string;
}

interface ClientFormProps {
  initial?: Partial<ClientFormData> & { _id?: string };
  onSave: (data: ClientFormData) => Promise<void>;
  onCancel: () => void;
}

export function ClientForm({ initial, onSave, onCancel }: ClientFormProps) {
  const [form, setForm] = useState<ClientFormData>({
    code: initial?.code || "",
    name: initial?.name || "",
    type: initial?.type || "company",
    nif: initial?.nif || "",
    rccm: initial?.rccm || "",
    email: initial?.email || "",
    phone: initial?.phone || "",
    address: initial?.address || "",
    creditLimit: initial?.creditLimit ?? 0,
    paymentTermDays: initial?.paymentTermDays ?? 30,
    isActive: initial?.isActive ?? true,
    notes: initial?.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(field: keyof ClientFormData, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Le nom est obligatoire");
    if (!form.code.trim()) return setError("Le code est obligatoire");
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const labelCls = "block text-xs font-medium text-moss mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Identité */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">
          Identité
        </legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Code *</label>
            <input className={inputCls} value={form.code} onChange={(e) => update("code", e.target.value)} placeholder="CLI-001" required />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls} value={form.type} onChange={(e) => update("type", e.target.value)}>
              <option value="company">Entreprise</option>
              <option value="individual">Particulier</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Nom / Raison sociale *</label>
          <input className={inputCls} value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Nom du client" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>NIF</label>
            <input className={inputCls} value={form.nif} onChange={(e) => update("nif", e.target.value)} placeholder="Numéro d'identification fiscale" />
          </div>
          <div>
            <label className={labelCls}>RCCM</label>
            <input className={inputCls} value={form.rccm} onChange={(e) => update("rccm", e.target.value)} placeholder="Registre de commerce" />
          </div>
        </div>
      </fieldset>

      {/* Contact */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">
          Contact
        </legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" className={inputCls} value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="contact@client.ne" />
          </div>
          <div>
            <label className={labelCls}>Téléphone</label>
            <input className={inputCls} value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+227 XX XX XX XX" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Adresse</label>
          <textarea className={inputCls} rows={2} value={form.address} onChange={(e) => update("address", e.target.value)} placeholder="Adresse complète" />
        </div>
      </fieldset>

      {/* Conditions commerciales */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink border-b border-clay/20 pb-2 w-full">
          Conditions commerciales
        </legend>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Limite de crédit (XOF)</label>
            <input type="number" className={inputCls} value={form.creditLimit} onChange={(e) => update("creditLimit", Number(e.target.value))} min={0} />
          </div>
          <div>
            <label className={labelCls}>Délai de paiement (jours)</label>
            <input type="number" className={inputCls} value={form.paymentTermDays} onChange={(e) => update("paymentTermDays", Number(e.target.value))} min={0} max={365} />
          </div>
        </div>
      </fieldset>

      {/* Notes + Statut */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className={labelCls}>Notes internes</label>
          <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Informations complémentaires…" />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isActive"
            checked={form.isActive}
            onChange={(e) => update("isActive", e.target.checked)}
            className="w-4 h-4 accent-cedar"
          />
          <label htmlFor="isActive" className="text-sm text-ink">Client actif</label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2 border-t border-clay/20">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-clay/30 rounded-lg text-moss hover:bg-sand transition-colors">
          Annuler
        </button>
        <button type="submit" disabled={saving} className="px-5 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors disabled:opacity-60">
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
