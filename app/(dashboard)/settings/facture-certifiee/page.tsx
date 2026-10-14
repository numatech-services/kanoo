"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ExternalLink, Check, X, AlertTriangle } from "lucide-react";
import { FormField, inputCls } from "@/components/ui/FormField";
import { DonutChart } from "@/components/ui/charts/DonutChart";

import { buttonClass } from "@/components/ui/button-class";
interface Status {
  identity: { nif?: string; isf?: string; mcfId?: string; certifiedSince: string | null };
  activeDriver: string;
  activeLabel: string;
  automatic: boolean;
  portalUrl: string;
  drivers: Array<{ name: string; label: string; automatic: boolean; configured: boolean }>;
  checklist: Array<{ key: string; label: string; done: boolean; hint: string }>;
  invoices: { issued: number; certified: number; pending: number; coverage: number | null };
}

export default function FactureCertifieePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState({ nif: "", isf: "", mcfId: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch("/api/secef/status", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error);
        setStatus(d.data);
        setForm({
          nif: d.data.identity.nif || "",
          isf: d.data.identity.isf || "",
          mcfId: d.data.identity.mcfId || "",
        });
      })
      .catch(e => setMessage({ kind: "err", text: e.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const res = await fetch("/api/secef/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Enregistrement refusé");
      setMessage({ kind: "ok", text: "Identité de facturation enregistrée." });
      load();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Enregistrement impossible" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="h-64 bg-surface rounded-xl border border-line animate-pulse" />;
  if (!status) {
    return (
      <div className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
        {message?.text || "État de certification indisponible."}
      </div>
    );
  }

  const { invoices, checklist } = status;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-xl bg-section-soft text-section flex items-center justify-center">
            <ShieldCheck size={17} />
          </span>
          <h1 className="page-title">Facture certifiée — SECeF</h1>
        </div>
        <p className="text-sm text-ink2 mt-1">
          Depuis le 1<sup>er</sup> septembre 2021, tout assujetti à la TVA au Niger émet
          des factures certifiées par le Système Électronique Certifié de Facturation.
          Chaque facture porte un code SECeF/DGI et un QR code, et se conserve dix ans.
        </p>
      </div>

      {message && (
        <p className={`px-4 py-3 rounded-xl text-sm border ${
          message.kind === "ok" ? "bg-pos-50 border-pos/25 text-pos" : "bg-neg-50 border-neg/25 text-neg"
        }`}>
          {message.text}
        </p>
      )}

      {/* ── Couverture réelle ─────────────────────────────────────────── */}
      <section className="bg-surface rounded-xl border border-line p-5">
        <h2 className="font-semibold text-ink">Couverture des factures émises</h2>
        <p className="text-xs text-ink2 mt-0.5 mb-4">
          Mesurée sur les factures réellement enregistrées, brouillons et annulations exclus.
        </p>

        {invoices.issued === 0 ? (
          <p className="text-sm text-ink3">Aucune facture émise pour l&apos;instant.</p>
        ) : (
          <>
            <DonutChart
              size={150}
              centerLabel="Factures émises"
              formatValue={v => String(Math.round(v))}
              slices={[
                { label: "Certifiées", value: invoices.certified, color: "rgb(var(--c-pos))" },
                { label: "Non certifiées", value: invoices.pending, color: "rgb(var(--c-neg))" },
              ]}
            />
            {invoices.pending > 0 && (
              <p className="mt-4 px-3 py-2 rounded-lg bg-warn-50 border border-warn/25 text-sm text-warn flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>
                  {invoices.pending} facture(s) émise(s) sans certification. Une facture non
                  certifiée n&apos;est pas opposable et expose à une sanction en cas de contrôle.
                </span>
              </p>
            )}
          </>
        )}
      </section>

      {/* ── Prérequis ─────────────────────────────────────────────────── */}
      <section className="bg-surface rounded-xl border border-line p-5">
        <h2 className="font-semibold text-ink mb-1">Prérequis</h2>
        <p className="text-xs text-ink2 mb-4">
          Kanoo constate ce qui est renseigné ici&nbsp;; seule la DGI peut attester d&apos;un agrément.
        </p>
        <ul className="space-y-2.5">
          {checklist.map(item => (
            <li key={item.key} className="flex items-start gap-3">
              <span className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                item.done ? "bg-pos-50 text-pos" : "bg-line text-ink3"
              }`}>
                {item.done ? <Check size={12} /> : <X size={12} />}
              </span>
              <div>
                <p className={`text-sm ${item.done ? "text-ink" : "text-ink2"}`}>{item.label}</p>
                <p className="text-xs text-ink3">{item.hint}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Mode de certification ─────────────────────────────────────── */}
      <section className="bg-surface rounded-xl border border-line p-5">
        <h2 className="font-semibold text-ink mb-1">Mode de certification</h2>
        <p className="text-xs text-ink2 mb-4">
          Le premier pilote configuré est utilisé. Sans agrément, le mode portail
          reste disponible et suffit à être en règle.
        </p>

        <div className="space-y-3">
          {status.drivers.map(d => (
            <div key={d.name}
              className={`rounded-lg border p-3 ${
                d.name === status.activeDriver ? "border-section bg-section-soft" : "border-line"
              }`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink">
                    {d.label}
                    {d.name === status.activeDriver && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-section font-bold">actif</span>
                    )}
                  </p>
                  <p className="text-xs text-ink2">
                    {d.automatic
                      ? "Certification automatique à l'émission de la facture."
                      : "Émission sur le portail DGI, puis report du code et du QR dans Kanoo."}
                  </p>
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                  d.configured ? "bg-pos-50 text-pos" : "bg-line text-ink3"
                }`}>
                  {d.configured ? "Configuré" : "Non configuré"}
                </span>
              </div>
            </div>
          ))}
        </div>

        <a href={status.portalUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-section font-medium mt-4 hover:underline">
          Ouvrir le portail e-SECeF <ExternalLink size={13} />
        </a>
      </section>

      {/* ── Identité ──────────────────────────────────────────────────── */}
      <section className="bg-surface rounded-xl border border-line p-5">
        <h2 className="font-semibold text-ink mb-4">Identité de facturation</h2>
        <form onSubmit={save} className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <FormField label="NIF de l'organisation" required
              hint="Figure sur toute facture certifiée">
              <input className={inputCls} value={form.nif} required
                onChange={e => setForm(p => ({ ...p, nif: e.target.value }))} />
            </FormField>
            <FormField label="Identifiant ISF"
              hint="Délivré avec le certificat de conformité du SFE">
              <input className={inputCls} value={form.isf}
                placeholder="Après agrément DGI"
                onChange={e => setForm(p => ({ ...p, isf: e.target.value }))} />
            </FormField>
            <FormField label="Identifiant MCF"
              hint="Boîtier, unité de facturation ou compte e-MCF">
              <input className={inputCls} value={form.mcfId}
                onChange={e => setForm(p => ({ ...p, mcfId: e.target.value }))} />
            </FormField>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={saving}
              className={buttonClass("primary", "md")}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </section>

      <section className="bg-surface2 rounded-xl border border-line p-5">
        <h2 className="text-sm font-bold text-ink">Passer à la certification automatique</h2>
        <ol className="mt-3 space-y-2 text-sm text-ink2 list-decimal list-inside">
          <li>Soumettre Kanoo à la procédure d&apos;agrément SFE auprès de la DGI et obtenir le certificat de conformité et l&apos;identifiant ISF.</li>
          <li>Récupérer la spécification de l&apos;API e-MCF et le jeton d&apos;accès, remis avec l&apos;agrément.</li>
          <li>Renseigner <code className="text-xs">SECEF_EMCF_BASE_URL</code> et <code className="text-xs">SECEF_EMCF_TOKEN</code>, puis valider en environnement de test.</li>
        </ol>
        <p className="text-xs text-ink3 mt-3">
          La marche à suivre détaillée figure dans <code className="text-xs">docs/SECEF.md</code>.
        </p>
      </section>
    </div>
  );
}
