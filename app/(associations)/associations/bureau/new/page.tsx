"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";

const ROLES: Array<[string, string]> = [
  ["president", "Président(e)"],
  ["vice_president", "Vice-Président(e)"],
  ["secretaire_general", "Secrétaire Général(e)"],
  ["secretaire_adjoint", "Secrétaire Adjoint(e)"],
  ["tresorier", "Trésorier(e)"],
  ["tresorier_adjoint", "Trésorier(e) Adjoint(e)"],
  ["commissaire_aux_comptes", "Commissaire aux Comptes"],
  ["conseiller", "Conseiller(ère)"],
  ["charge_de_mission", "Chargé(e) de Mission"],
  ["autre", "Autre"],
];

export default function NewBureauMemberPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    role: "president",
    customRoleLabel: "",
    email: "",
    phone: "",
    mandateStart: new Date().toISOString().slice(0, 10),
    mandateEnd: "",
  });

  const u = (f: string, v: string) => {
    setError("");
    setForm((p) => ({ ...p, [f]: v }));
  };

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    // Nettoyage du payload
    const payload = { ...form };
    if (!payload.email?.trim()) delete (payload as any).email;
    if (!payload.phone?.trim()) delete (payload as any).phone;
    if (!payload.mandateEnd) delete (payload as any).mandateEnd;
    if (payload.role !== "autre") delete (payload as any).customRoleLabel;

    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();

      const res = await fetch("/api/bureau", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        setError(errData.error || "Une erreur est survenue");
        setSaving(false);
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      router.push("/associations/bureau");
      router.refresh();
    } catch (err) {
      console.error("Error:", err);
      setError("Impossible de contacter le serveur");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-4">
      <div>
        <button onClick={() => router.back()} className="text-xs text-moss hover:underline mb-3">
          ← Retour
        </button>
        <h1 className="text-2xl font-bold">Ajouter un membre du bureau</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white p-6 rounded-xl shadow-sm border space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Prénom" required>
            <input className={inputCls} value={form.firstName} onChange={(e) => u("firstName", e.target.value)} required />
          </FormField>
          <FormField label="Nom" required>
            <input className={inputCls} value={form.lastName} onChange={(e) => u("lastName", e.target.value)} required />
          </FormField>
        </div>

        <FormField label="Fonction" required>
          <select className={selectCls} value={form.role} onChange={(e) => u("role", e.target.value)}>
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </FormField>

        {form.role === "autre" && (
          <FormField label="Libellé personnalisé" required>
            <input className={inputCls} value={form.customRoleLabel} onChange={(e) => u("customRoleLabel", e.target.value)} required />
          </FormField>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Email">
            <input type="email" className={inputCls} value={form.email} onChange={(e) => u("email", e.target.value)} />
          </FormField>
          <FormField label="Téléphone">
            <input className={inputCls} value={form.phone} onChange={(e) => u("phone", e.target.value)} />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Début du mandat" required>
            <input type="date" className={inputCls} value={form.mandateStart} onChange={(e) => u("mandateStart", e.target.value)} required />
          </FormField>
          <FormField label="Fin du mandat">
            <input type="date" className={inputCls} value={form.mandateEnd} onChange={(e) => u("mandateEnd", e.target.value)} />
          </FormField>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border rounded-xl">Annuler</button>
          <button type="submit" disabled={saving} className="px-6 py-2 bg-cedar text-white rounded-xl disabled:opacity-50">
            {saving ? "Enregistrement..." : "Ajouter le membre"}
          </button>
        </div>
      </form>
    </div>
  );
}