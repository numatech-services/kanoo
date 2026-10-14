"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Check, QrCode } from "lucide-react";
import { FormField, inputCls, textareaCls } from "@/components/ui/FormField";
import { Inset } from "@/components/ui/Primitives";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
interface Branding {
  primaryColor?: string; secondaryColor?: string;
  showLogo?: boolean; tagline?: string; legalFooter?: string;
  paymentInstructions?: string; defaultTerms?: string;
  documentQr?: boolean; headerLayout?: "left" | "centered";
}
interface Company {
  name?: string; logo?: string; nif?: string; rccm?: string;
  address?: string; phone?: string; email?: string; branding?: Branding;
}


export default function BrandingPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [form, setForm] = useState<Branding & { logo?: string }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson("/api/company/branding")
      .then(d => {
        if (!d.success) throw new Error(d.error);
        const c: Company = d.data;
        setCompany(c);
        setForm({
          logo: c.logo,
          primaryColor: c.branding?.primaryColor || "#2F3E46",
          secondaryColor: c.branding?.secondaryColor || "#8A8F98",
          showLogo: c.branding?.showLogo !== false,
          tagline: c.branding?.tagline || "",
          legalFooter: c.branding?.legalFooter || "",
          paymentInstructions: c.branding?.paymentInstructions || "",
          defaultTerms: c.branding?.defaultTerms || "",
          documentQr: c.branding?.documentQr !== false,
          headerLayout: c.branding?.headerLayout || "left",
        });
      })
      .catch(() => setError("Chargement impossible."))
      .finally(() => setLoading(false));
  }, []);

  function pickLogo(file: File) {
    if (file.size > 500_000) { setError("Logo trop lourd (500 Ko max)."); return; }
    const reader = new FileReader();
    reader.onload = () => setForm(f => ({ ...f, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiSend("PATCH", "/api/company/branding", form);
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Enregistrement refusé");
      setNotice("Personnalisation enregistrée. Elle s'applique aux prochains documents générés.");
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
        <Link href="/settings" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
          <ArrowLeft size={13} /> Réglages
        </Link>
        <h1 className="page-title mt-1">Apparence des documents</h1>
        <p className="text-sm text-ink2">
          Logo, couleurs, mentions et QR de vos factures, devis et courriers. Chaque
          organisation a la sienne.
        </p>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      {/* Logo + couleurs */}
      <section className="surface-card p-5 space-y-4">
        <h2 className="font-semibold text-ink">Identité visuelle</h2>
        <div className="flex items-start gap-5">
          <div className="w-32 h-20 rounded-lg border border-line2 bg-surface2 grid place-items-center overflow-hidden shrink-0">
            {form.logo
              ? <img src={form.logo} alt="Logo" className="max-w-full max-h-full object-contain" />
              : <span className="text-xs text-ink3">Aucun logo</span>}
          </div>
          <div className="space-y-2">
            <label className="inline-flex items-center gap-2 px-3 h-9 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2 cursor-pointer">
              <Upload size={15} /> Choisir un logo
              <input type="file" accept="image/png,image/jpeg" className="hidden"
                onChange={e => e.target.files?.[0] && pickLogo(e.target.files[0])} />
            </label>
            {form.logo && (
              <button type="button" onClick={() => setForm(f => ({ ...f, logo: "" }))}
                className="block text-xs text-neg hover:underline">Retirer le logo</button>
            )}
            <label className="flex items-center gap-2 text-sm text-ink2 cursor-pointer">
              <input type="checkbox" className="accent-section" checked={form.showLogo}
                onChange={e => setForm(f => ({ ...f, showLogo: e.target.checked }))} />
              Afficher le logo en tête des documents
            </label>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Couleur principale" hint="En-tête, titres, total.">
            <div className="flex items-center gap-2">
              <input type="color" value={form.primaryColor}
                onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                className="w-10 h-10 rounded border border-line2 cursor-pointer" />
              <input className={inputCls} value={form.primaryColor}
                onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))} />
            </div>
          </FormField>
          <FormField label="Couleur secondaire">
            <div className="flex items-center gap-2">
              <input type="color" value={form.secondaryColor}
                onChange={e => setForm(f => ({ ...f, secondaryColor: e.target.value }))}
                className="w-10 h-10 rounded border border-line2 cursor-pointer" />
              <input className={inputCls} value={form.secondaryColor}
                onChange={e => setForm(f => ({ ...f, secondaryColor: e.target.value }))} />
            </div>
          </FormField>
        </div>

        <FormField label="Slogan / raison sociale complète" hint="Affiché sous le nom, en petit.">
          <input className={inputCls} value={form.tagline}
            onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
            placeholder="Ex. Solutions numériques pour le Sahel" />
        </FormField>
      </section>

      {/* Textes de document */}
      <section className="surface-card p-5 space-y-4">
        <h2 className="font-semibold text-ink">Mentions et paiement</h2>
        <FormField label="Instructions de paiement"
          hint="Coordonnées bancaires, Orange/Moov/Airtel Money — imprimées sur les factures.">
          <textarea className={textareaCls} rows={2} value={form.paymentInstructions}
            onChange={e => setForm(f => ({ ...f, paymentInstructions: e.target.value }))}
            placeholder="Virement : BOA NE… · Orange Money : 90 00 00 00" />
        </FormField>
        <FormField label="Mentions légales (pied de page)"
          hint="RCCM, capital, siège social… en bas de chaque document.">
          <textarea className={textareaCls} rows={2} value={form.legalFooter}
            onChange={e => setForm(f => ({ ...f, legalFooter: e.target.value }))} />
        </FormField>
        <FormField label="Conditions par défaut"
          hint="Ajoutées aux devis et factures qui n'ont pas de note propre.">
          <textarea className={textareaCls} rows={2} value={form.defaultTerms}
            onChange={e => setForm(f => ({ ...f, defaultTerms: e.target.value }))}
            placeholder="Ex. Règlement à 30 jours. Pénalités de retard au taux légal." />
        </FormField>
      </section>

      {/* QR */}
      <section className="surface-card p-5 space-y-3">
        <h2 className="font-semibold text-ink flex items-center gap-2"><QrCode size={17} /> QR de vérification</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="accent-section mt-0.5" checked={form.documentQr}
            onChange={e => setForm(f => ({ ...f, documentQr: e.target.checked }))} />
          <span>
            <span className="text-sm text-ink">Apposer un QR sur les documents générés</span>
            <span className="block text-xs text-ink2 mt-0.5">
              Une facture certifiée SECeF porte le QR officiel des impôts ; les autres
              documents portent un QR de résumé vérifiable (référence, montant, date).
            </span>
          </span>
        </label>
        <Inset tone="info">
          La personnalisation s&apos;applique aux <strong>prochains documents générés</strong> ;
          les PDF déjà téléchargés ne changent pas. Ouvrez une facture puis « Imprimer »
          pour voir le rendu.
        </Inset>
      </section>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving}
          className={buttonClass("primary", "md")}>
          <Check size={16} /> {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
      {company && <p className="text-xs text-ink3">Organisation : {company.name}</p>}
    </div>
  );
}
