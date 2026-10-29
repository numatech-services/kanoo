"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles, KeyRound, CheckCircle2 } from "lucide-react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { buttonClass } from "@/components/ui/button-class";
import { confirmDialog } from "@/components/ui/Dialogs";
import { apiJson, apiSend } from "@/lib/api-client";
import { PageError } from "@/components/ui/PageState";

interface AiState {
  source: "tenant" | "platform" | null;
  keyHint: string | null;
  keySetAt: string | null;
  model: string;
  monthlyQuota: number | null;
  platformAvailable: boolean;
  models: Array<{ id: string; label: string }>;
  quota: { used: number; quota: number; remaining: number; month: string };
}

/**
 * Réglages de l'assistant Claude : clé d'API Anthropic de l'organisation,
 * modèle, plafond mensuel, test de connexion. La clé n'est jamais réaffichée.
 */
export default function AssistantSettingsPage() {
  const [state, setState] = useState<AiState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [quota, setQuota] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function apply(s: AiState) {
    setState(s); setModel(s.model); setQuota(s.monthlyQuota == null ? "" : String(s.monthlyQuota));
  }
  useEffect(() => {
    apiJson("/api/company/ai").then(d => { if (d?.data) apply(d.data); else setLoadError(d?.error || "Lecture impossible."); })
      .catch(() => setLoadError("Lecture impossible."));
  }, []);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    const res = await apiSend("PATCH", "/api/company/ai", body);
    setBusy(false);
    if (!res.ok) { setError(res.data?.error || "Enregistrement impossible."); return false; }
    apply(res.data.data); setNotice(done);
    return true;
  }
  async function test() {
    setBusy(true); setError(""); setNotice("");
    const res = await apiSend("POST", "/api/company/ai/test", { apiKey: apiKey.trim() || undefined, model });
    setBusy(false);
    if (!res.ok) setError(res.data?.error || "Test impossible.");
    else setNotice(`Connexion réussie : ${res.data.data.label ?? res.data.data.model} est accessible avec ${apiKey.trim() ? "cette clé" : "la clé en place"}.`);
  }

  if (loadError) return <PageError message={loadError} />;
  if (!state) return <div className="h-96 surface-card animate-pulse" />;
  const own = state.source === "tenant";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/settings" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
          <ArrowLeft size={13} /> Réglages
        </Link>
        <h1 className="page-title mt-1 inline-flex items-center gap-2"><Sparkles size={20} className="text-section" /> Assistant Claude</h1>
        <p className="text-sm text-ink2">
          Claude prépare vos devis et proformas à partir d&apos;une description, rédige vos courriers et lit vos factures
          fournisseurs. Vous relisez toujours avant d&apos;enregistrer ou d&apos;envoyer.
        </p>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      <section className="surface-card p-5 space-y-3">
        <h2 className="font-semibold text-ink">État</h2>
        <p className="text-sm">
          {own ? <>Clé de l&apos;organisation <span className="font-mono">{state.keyHint}</span>{state.keySetAt ? `, enregistrée le ${new Date(state.keySetAt).toLocaleDateString("fr-FR")}` : ""} : la consommation est facturée sur votre compte Anthropic.</>
            : state.source === "platform" ? <>Clé de la plateforme Kanoo, avec son plafond mensuel. Enregistrez votre propre clé pour choisir le modèle et le plafond.</>
            : <span className="text-warn">Aucune clé : l&apos;assistant est désactivé. Enregistrez la clé d&apos;API de l&apos;organisation ci-dessous.</span>}
        </p>
        <p className="text-sm text-ink2">Ce mois-ci : <strong className="text-ink">{state.quota.used}</strong> génération{state.quota.used > 1 ? "s" : ""} sur {state.quota.quota} ({state.quota.remaining} restante{state.quota.remaining > 1 ? "s" : ""}).</p>
      </section>

      <section className="surface-card p-5 space-y-4">
        <h2 className="font-semibold text-ink inline-flex items-center gap-2"><KeyRound size={16} /> Clé d&apos;API Anthropic</h2>
        <p className="text-sm text-ink2">
          Créez une clé sur <span className="font-mono">console.anthropic.com</span> → API Keys, puis collez-la ici. Elle est chiffrée
          et ne s&apos;affiche plus jamais ; seuls ses quatre derniers caractères restent visibles.
        </p>
        <FormField label={own ? "Remplacer la clé" : "Clé d'API"}>
          <input type="password" autoComplete="off" spellCheck={false} className={`${inputCls} font-mono`} value={apiKey}
            onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-…" />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !apiKey.trim()} className={buttonClass("primary", "md")}
            onClick={async () => { if (await save({ apiKey: apiKey.trim() }, "Clé enregistrée.")) setApiKey(""); }}>
            Enregistrer la clé
          </button>
          <button type="button" disabled={busy || (!apiKey.trim() && !state.source)} onClick={test} className={buttonClass("secondary", "md")}>
            <CheckCircle2 size={16} /> Tester la connexion
          </button>
          {own && (
            <button type="button" disabled={busy} className={buttonClass("danger", "md")} onClick={async () => {
              if (await confirmDialog({ title: "Retirer la clé de l'organisation ?", message: state.platformAvailable ? "L'assistant repassera sur la clé de la plateforme et son plafond." : "L'assistant sera désactivé.", danger: true }))
                await save({ removeKey: true }, "Clé retirée.");
            }}>Retirer la clé</button>
          )}
        </div>
        <p className="text-[11px] text-ink3">Le test vérifie la clé et l&apos;accès au modèle sans rien générer : il n&apos;est ni facturé ni décompté.</p>
      </section>

      <section className="surface-card p-5 space-y-4">
        <h2 className="font-semibold text-ink">Modèle et plafond</h2>
        {!own && <p className="text-sm text-ink2">Avec la clé de la plateforme, le modèle et le plafond sont ceux de Kanoo. Ils deviennent réglables dès que votre clé est enregistrée.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Modèle">
            <select className={selectCls} value={model} onChange={e => setModel(e.target.value)} disabled={!own}>
              {state.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </FormField>
          <FormField label="Plafond mensuel (générations)" hint="Vide : 500 par mois. 0 : assistant suspendu.">
            <input type="number" inputMode="numeric" min={0} max={100000} className={inputCls} value={quota} disabled={!own}
              onChange={e => setQuota(e.target.value)} placeholder="500" />
          </FormField>
        </div>
        <button type="button" disabled={busy || !own} className={buttonClass("primary", "md")}
          onClick={() => save({ model, monthlyQuota: quota.trim() === "" ? null : Number(quota) }, "Réglages enregistrés.")}>
          Enregistrer
        </button>
      </section>

      <section className="surface-card p-5 space-y-2 text-sm text-ink2">
        <h2 className="font-semibold text-ink">Ce qui est transmis à Claude</h2>
        <p>Devis et proformas : votre description du besoin telle que saisie, le catalogue d&apos;articles (codes, désignations, prix) et vos conditions habituelles — pas les fiches clients. N&apos;écrivez pas de données personnelles dans la description.</p>
        <p>Courriers : l&apos;objet, le destinataire et vos consignes ; pour un rapport d&apos;activité, des totaux seulement.</p>
        <p>Factures fournisseurs : le document que vous déposez.</p>
        <p>Les prix d&apos;un devis viennent du catalogue Kanoo, ou de votre description ; sinon la ligne est signalée « à chiffrer ».</p>
        <p>Ces données sont traitées par Anthropic, société américaine qui fournit le modèle Claude. Mentionnez ce sous-traitant dans votre politique de confidentialité si vos documents contiennent des données de tiers.</p>
      </section>
    </div>
  );
}
