"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Check, Palette } from "lucide-react";
import { FormField, inputCls, textareaCls } from "@/components/ui/FormField";
import { LogoPicker } from "@/components/ui/LogoPicker";
import { Inset } from "@/components/ui/Primitives";
import { invalidateMe } from "@/lib/useMe";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
import { TreasuryAccountSelect } from "@/components/shared/TreasuryAccountSelect";
interface Company {
  name?: string; type?: string; nif?: string; rccm?: string;
  address?: string; phone?: string; email?: string; logo?: string;
  onlinePaymentAccountId?: string | null;
}

const TYPE_LABEL: Record<string, string> = { pme: "Entreprise (PME)", association: "Association / ONG", administration: "Administration" };


export default function CompanyPage() {
  const [form, setForm] = useState<Company>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson("/api/company")
      .then(d => { if (!d.success) throw new Error(d.error); setForm(d.data); })
      .catch(() => setError("Chargement impossible."))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!form.name?.trim()) { setError("Le nom de l'organisation est requis."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await apiSend("PATCH", "/api/company", form);
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Enregistrement refusé");
      invalidateMe(); // rafraîchit la marque dans la barre latérale
      setNotice("Organisation mise à jour. Le logo et le nom s'affichent dans l'interface.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="h-96 surface-card animate-pulse" />;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/settings" className="text-xs text-ink2 hover:text-ink">← Réglages</Link>
        <h1 className="page-title mt-1 flex items-center gap-2"><Building2 size={22} /> Mon organisation</h1>
        <p className="text-sm text-ink2">
          Identité légale et logo de votre organisation
          {form.type ? ` — ${TYPE_LABEL[form.type] || form.type}` : ""}.
        </p>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      <section className="surface-card p-5 space-y-4">
        <h2 className="font-semibold text-ink">Identité</h2>
        <LogoPicker value={form.logo} onChange={v => setForm(f => ({ ...f, logo: v }))}
          maxBytes={500_000} label="Logo de l'organisation" hint="PNG ou JPEG, 500 Ko max. Affiché dans la barre latérale et sur vos documents." />
        <FormField label="Nom / Raison sociale" required>
          <input className={inputCls} value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </FormField>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="NIF">
            <input className={inputCls} value={form.nif || ""} onChange={e => setForm(f => ({ ...f, nif: e.target.value }))} />
          </FormField>
          <FormField label="RCCM">
            <input className={inputCls} value={form.rccm || ""} onChange={e => setForm(f => ({ ...f, rccm: e.target.value }))} />
          </FormField>
        </div>
      </section>

      <section className="surface-card p-5 space-y-4">
        <h2 className="font-semibold text-ink">Coordonnées</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Téléphone">
            <input className={inputCls} value={form.phone || ""} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </FormField>
          <FormField label="Email">
            <input type="email" className={inputCls} value={form.email || ""} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </FormField>
        </div>
        <FormField label="Adresse">
          <textarea className={textareaCls} rows={2} value={form.address || ""} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
        </FormField>
      </section>

      <section className="surface-card p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-ink">Paiements en ligne</h2>
          <p className="text-xs text-ink2 mt-0.5">Vos clients règlent leurs factures en mobile money ou par carte depuis leur portail (fiche client › Portail client). Chaque paiement confirmé est enregistré et comptabilisé sur ce compte.</p>
        </div>
        <FormField label="Compte qui reçoit les paiements en ligne">
          <TreasuryAccountSelect value={form.onlinePaymentAccountId ? String(form.onlinePaymentAccountId) : ""} autoSelect={false}
            onChange={v => setForm(f => ({ ...f, onlinePaymentAccountId: v || null }))} />
        </FormField>
      </section>

      <Inset tone="info">
        Pour les couleurs, mentions et QR de vos <strong>documents</strong> (factures, devis, courriers),
        rendez-vous dans <Link href="/company/branding" className="text-section hover:underline inline-flex items-center gap-1"><Palette size={13} /> Apparence des documents</Link>.
      </Inset>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving}
          className={buttonClass("primary", "md")}>
          <Check size={16} /> {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
