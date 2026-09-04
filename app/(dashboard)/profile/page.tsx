"use client";

import { useEffect, useState } from "react";
import { User, Check } from "lucide-react";
import { FormField, inputCls } from "@/components/ui/FormField";
import { invalidateMe } from "@/lib/useMe";

interface Profile { firstName?: string; lastName?: string; phone?: string; email?: string; role?: string; }

export default function ProfilePage() {
  const [form, setForm] = useState<Profile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.json())
      .then(d => setForm(d.data?.user || {}))
      .catch(() => setError("Chargement impossible."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setError(null); setNotice(null);
    try {
      const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, phone: form.phone }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Enregistrement refusé");
      invalidateMe(); // rafraîchit l'en-tête (initiales, nom)
      setNotice("Profil mis à jour.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="h-64 surface-card animate-pulse" />;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><User size={22} /> Mon profil</h1>
        <p className="text-sm text-ink2">Vos informations personnelles et votre rôle.</p>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      <section className="surface-card p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Prénom">
            <input className={inputCls} value={form.firstName || ""} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
          </FormField>
          <FormField label="Nom">
            <input className={inputCls} value={form.lastName || ""} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
          </FormField>
        </div>
        <FormField label="Téléphone">
          <input className={inputCls} value={form.phone || ""} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+227 XX XX XX XX" />
        </FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Email" hint="Non modifiable ici.">
            <input className={inputCls} value={form.email || ""} disabled />
          </FormField>
          <FormField label="Rôle" hint="Défini par un administrateur.">
            <input className={`${inputCls} capitalize`} value={(form.role || "").replace(/_/g, " ")} disabled />
          </FormField>
        </div>
      </section>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving}
          className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60 inline-flex items-center gap-2">
          <Check size={16} /> {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
