"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Send, Settings2, ShieldAlert, Clock, CheckCircle2, AlertTriangle, Info,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { BarChart } from "@/components/ui/charts/BarChart";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";
import { fullXof, compactXof } from "@/components/ui/charts/geometry";
import type { DunningPlan, DunningSettings, AgingBucket } from "@/lib/dunning";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
interface Payload {
  asOf: string;
  enabled: boolean;
  settings: DunningSettings & { bccEmail?: string };
  plan: DunningPlan;
  aging: AgingBucket[];
  averageDelay: number | null;
  averageDelayIsApproximate: boolean;
  history: Array<{
    _id: string; sentAt: string; outcome: string; stepLabel?: string;
    channels?: string[]; outstanding?: number; automatic?: boolean;
    invoiceId?: { number?: string }; clientId?: { name?: string };
  }>;
}

const TONE_LABEL: Record<string, string> = {
  courtesy: "Courtoisie", reminder: "Rappel", firm: "Ferme", formal_notice: "Mise en demeure",
};
const CHANNEL_LABEL: Record<string, string> = {
  email: "Courriel", sms: "SMS", whatsapp: "WhatsApp",
};
const OUTCOME: Record<string, { label: string; cls: string }> = {
  sent: { label: "Envoyée", cls: "text-pos" },
  partial: { label: "Partielle", cls: "text-warn" },
  failed: { label: "Échec", cls: "text-neg" },
  superseded: { label: "Dépassée", cls: "text-ink3" },
};


export default function RelancesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approved, setApproved] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    apiJson("/api/relances")
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setData(d.data);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function run(invoiceIds?: string[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiSend("POST", "/api/relances/executer", {
          ...(invoiceIds ? { invoiceIds } : {}),
          approvedInvoiceIds: [...approved],
        });
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Exécution refusée");
      setNotice(d.data.message);
      setApproved(new Set());
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Exécution impossible");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(enabled: boolean) {
    setBusy(true);
    try {
      const res = await apiSend("PUT", "/api/relances/parametres", { enabled });
      if (!res.ok) throw new Error((res.data).error);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="h-96 surface-card animate-pulse" />;
  if (!data) {
    return <p className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">
      {error || "Relances indisponibles."}
    </p>;
  }

  const { plan, aging, settings } = data;
  const ready = plan.actions.filter(a => !a.needsApproval);
  const toApprove = plan.actions.filter(a => a.needsApproval);
  const overdueTotal = aging.slice(1).reduce((s, b) => s + b.amount, 0);
  const overdueCount = aging.slice(1).reduce((s, b) => s + b.count, 0);

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">Relances</h1>
          <p className="text-sm text-ink2">
            Ce que le traitement de 10 h enverra ce matin — et pourquoi les autres factures
            n&apos;y sont pas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSettingsOpen(true)}
            className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
            <Settings2 size={16} /> Barème
          </button>
          <button onClick={() => run()} disabled={busy || ready.length === 0 || !data.enabled}
            className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
            <Send size={16} /> Envoyer maintenant ({ready.length})
          </button>
        </div>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      {!data.enabled && (
        <div className="px-4 py-3 rounded-xl bg-warn-50 border border-warn/25 flex items-start gap-3">
          <ShieldAlert size={18} className="text-warn shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-warn">Les relances automatiques sont désactivées.</p>
            <p className="text-xs text-ink2 mt-0.5">
              Rien ne part tant que vous ne l&apos;avez pas décidé. Vérifiez le barème et
              l&apos;aperçu ci-dessous&nbsp;: le premier envoi touchera de vrais clients.
            </p>
          </div>
          <button onClick={() => toggleEnabled(true)} disabled={busy}
            className="px-3 h-9 rounded-lg bg-warn text-white text-xs font-semibold hover:brightness-95 shrink-0">
            Activer
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Impayés échus" value={overdueTotal} format={fullXof}
          tone={overdueTotal > 0 ? "neg" : "pos"} goodDirection="down"
          hint={`${overdueCount} facture(s) au-delà de l'échéance`} />
        <KpiCard label="Relances prêtes" value={ready.length}
          tone={ready.length > 0 ? "section" : "pos"}
          hint={plan.targetedAmount > 0 ? `${fullXof(plan.targetedAmount)} concernés` : "Rien à envoyer aujourd'hui"} />
        <KpiCard label="En attente de validation" value={toApprove.length}
          tone={toApprove.length > 0 ? "warn" : "pos"}
          hint="Mises en demeure — jamais envoyées automatiquement" />
        <KpiCard label="Délai moyen de règlement"
          value={data.averageDelay === null ? "—" : `${data.averageDelay > 0 ? "+" : ""}${data.averageDelay} j`}
          tone={data.averageDelay !== null && data.averageDelay > 15 ? "warn" : "info"}
          hint={data.averageDelay === null
            ? "Aucune facture réglée sur douze mois"
            : "Par rapport à l'échéance, pondéré par les montants"} />
      </div>

      {/* ── Balance âgée ────────────────────────────────────────────────── */}
      <section className="surface-card p-5">
        <h2 className="font-semibold text-ink">Balance âgée</h2>
        <p className="text-xs text-ink2 mt-0.5 mb-4">
          Cent mille francs à cinq jours et cent mille à six mois ne sont pas la même
          situation, ni le même travail.
        </p>
        <BarChart
          labels={aging.map(b => b.label)}
          series={[{ label: "Restant dû", values: aging.map(b => b.amount) }]}
          formatValue={compactXof}
          height={180}
          emptyMessage="Aucun impayé — rien à échelonner."
        />
      </section>

      {/* ── Validation requise ──────────────────────────────────────────── */}
      {toApprove.length > 0 && (
        <section className="surface-card overflow-hidden border-warn/30">
          <div className="p-5 pb-3">
            <h2 className="font-semibold text-warn flex items-center gap-2">
              <AlertTriangle size={16} /> {toApprove.length} mise(s) en demeure en attente
            </h2>
            <p className="text-xs text-ink2 mt-0.5">
              Une mise en demeure engage juridiquement et se lit comme une rupture de
              confiance. Elle ne part jamais d&apos;un automate&nbsp;: cochez celles que
              vous assumez, puis envoyez.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="table-dense min-w-[44rem]">
              <thead>
                <tr><th></th><th>Client</th><th>Facture</th><th>Retard</th><th>Restant dû</th></tr>
              </thead>
              <tbody>
                {toApprove.map(a => (
                  <tr key={a.invoiceId}>
                    <td>
                      <input type="checkbox" checked={approved.has(a.invoiceId)}
                        onChange={e => setApproved(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(a.invoiceId); else next.delete(a.invoiceId);
                          return next;
                        })} />
                    </td>
                    <td className="text-ink font-medium">{a.clientName}</td>
                    <td>
                      <Link href={`/invoices/${a.invoiceId}`} className="text-section hover:underline">
                        {a.invoiceNumber}
                      </Link>
                    </td>
                    <td className="text-neg num">{a.daysPastDue} j</td>
                    <td className="num text-right font-semibold text-ink">{fullXof(a.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-line flex justify-end">
            <button
              disabled={busy || approved.size === 0}
              onClick={() => run([...approved])}
              className="px-4 h-10 rounded-lg bg-warn text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
              Envoyer {approved.size} mise(s) en demeure
            </button>
          </div>
        </section>
      )}

      {/* ── Plan du jour ────────────────────────────────────────────────── */}
      <section className="surface-card overflow-hidden">
        <div className="p-5 pb-3">
          <h2 className="font-semibold text-ink">Relances prêtes à partir</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-dense min-w-[48rem]">
            <thead>
              <tr><th>Client</th><th>Facture</th><th>Étape</th><th>Canaux</th><th>Retard</th><th>Restant dû</th></tr>
            </thead>
            <tbody>
              {ready.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-ink3">
                  Aucune relance prévue aujourd&apos;hui.
                </td></tr>
              )}
              {ready.map(a => (
                <tr key={a.invoiceId}>
                  <td className="text-ink font-medium">{a.clientName}</td>
                  <td>
                    <Link href={`/invoices/${a.invoiceId}`} className="text-section hover:underline">
                      {a.invoiceNumber}
                    </Link>
                  </td>
                  <td>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-section-soft text-section">
                      {TONE_LABEL[a.step.tone]}
                    </span>
                    <span className="text-[11px] text-ink3 ml-2">{a.step.label}</span>
                  </td>
                  <td className="text-xs text-ink2">
                    {a.channels.map(c => CHANNEL_LABEL[c]).join(" + ")}
                  </td>
                  <td className={`num ${a.daysPastDue > 0 ? "text-neg" : "text-ink2"}`}>
                    {a.daysPastDue > 0 ? `${a.daysPastDue} j` : `dans ${-a.daysPastDue} j`}
                  </td>
                  <td className="num text-right font-semibold text-ink">{fullXof(a.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Écartées ────────────────────────────────────────────────────── */}
      {plan.skipped.length > 0 && (
        <section className="surface-card overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="font-semibold text-ink flex items-center gap-2">
              <Info size={15} className="text-ink3" />
              {plan.skipped.length} facture(s) non relancée(s)
            </h2>
            <p className="text-xs text-ink2 mt-0.5">
              Un impayé qu&apos;on ne relance pas doit s&apos;expliquer. Sinon on croit la
              campagne complète alors qu&apos;elle est silencieusement partielle.
            </p>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="table-dense">
              <thead><tr><th>Facture</th><th>Motif</th></tr></thead>
              <tbody>
                {plan.skipped.map(s => (
                  <tr key={`${s.invoiceId}-${s.reason}`}>
                    <td>
                      <Link href={`/invoices/${s.invoiceId}`} className="text-section hover:underline">
                        {s.invoiceNumber}
                      </Link>
                    </td>
                    <td className="text-ink2">{s.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Historique ──────────────────────────────────────────────────── */}
      {data.history.length > 0 && (
        <section className="surface-card overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="font-semibold text-ink flex items-center gap-2">
              <Clock size={15} className="text-ink3" /> Dernières relances
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="table-dense min-w-[44rem]">
              <thead>
                <tr><th>Date</th><th>Client</th><th>Facture</th><th>Étape</th><th>Canaux</th><th>Issue</th></tr>
              </thead>
              <tbody>
                {data.history.map(h => {
                  const out = OUTCOME[h.outcome] || { label: h.outcome, cls: "text-ink2" };
                  return (
                    <tr key={h._id}>
                      <td className="text-ink2 whitespace-nowrap">
                        {new Date(h.sentAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="text-ink">{h.clientId?.name || "—"}</td>
                      <td className="text-ink2">{h.invoiceId?.number || "—"}</td>
                      <td className="text-ink2 text-xs">{h.stepLabel || "—"}</td>
                      <td className="text-xs text-ink2">
                        {(h.channels || []).map(c => CHANNEL_LABEL[c]).join(", ") || "—"}
                      </td>
                      <td className={`text-xs font-medium ${out.cls}`}>
                        {out.label}
                        {h.automatic === false && <span className="text-ink3 font-normal"> · manuelle</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}
        settings={settings} enabled={data.enabled} onSaved={load} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function SettingsDialog({
  open, onClose, settings, enabled, onSaved,
}: {
  open: boolean; onClose: () => void;
  settings: DunningSettings & { bccEmail?: string };
  enabled: boolean; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    enabled,
    minAmount: settings.minAmount,
    minIntervalDays: settings.minIntervalDays,
    respectDisputes: settings.respectDisputes,
    sendDays: settings.sendDays,
    bccEmail: settings.bccEmail || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend("PUT", "/api/relances/parametres", form);
      const d = res.data;
      if (!res.ok) throw new Error(d.error || "Enregistrement refusé");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Barème de relance" size="lg">
      <form onSubmit={submit} className="space-y-5">
        <label className="flex items-start gap-3 p-3 rounded-lg border border-line2 cursor-pointer">
          <input type="checkbox" checked={form.enabled} className="mt-0.5"
            onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
          <span>
            <span className="text-sm font-medium text-ink">Relances automatiques actives</span>
            <span className="block text-xs text-ink2 mt-0.5">
              Le traitement de 10 h écrira à vos clients selon le barème ci-dessous.
            </span>
          </span>
        </label>

        <div className="rounded-lg border border-line overflow-hidden">
          <div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Quand</th><th>Étape</th><th>Ton</th><th>Canaux</th></tr></thead>
            <tbody>
              {settings.steps.map((s, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap text-ink2">
                    {s.offsetDays < 0 ? `J−${-s.offsetDays}` : `J+${s.offsetDays}`}
                  </td>
                  <td className="text-ink">
                    {s.label}
                    {s.requiresApproval && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-warn-50 text-warn">
                        validation
                      </span>
                    )}
                  </td>
                  <td className="text-xs text-ink2">{TONE_LABEL[s.tone]}</td>
                  <td className="text-xs text-ink2">
                    {s.channels.map(c => CHANNEL_LABEL[c]).join(" + ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
        <p className="text-xs text-ink3 -mt-3">
          Le barème par défaut ouvre par un rappel <em>avant</em> échéance&nbsp;: c&apos;est
          celui qui évite le retard plutôt que de le constater.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Seuil de relance (FCFA)"
            hint="En dessous, on ne relance pas : l'irritation coûte plus que la créance.">
            <input type="number" min={0} className={inputCls} value={form.minAmount}
              onChange={e => setForm(f => ({ ...f, minAmount: Number(e.target.value) }))} />
          </FormField>
          <FormField label="Intervalle minimum (jours)"
            hint="Délai plancher entre deux messages sur une même facture.">
            <input type="number" min={0} className={inputCls} value={form.minIntervalDays}
              onChange={e => setForm(f => ({ ...f, minIntervalDays: Number(e.target.value) }))} />
          </FormField>
        </div>

        <FormField label="Jours d'envoi">
          <div className="flex flex-wrap gap-2">
            {DAY_NAMES.map((name, day) => {
              const on = form.sendDays.includes(day);
              return (
                <button key={day} type="button"
                  onClick={() => setForm(f => ({
                    ...f,
                    sendDays: on ? f.sendDays.filter(d => d !== day) : [...f.sendDays, day].sort(),
                  }))}
                  className={`px-3 h-9 rounded-lg text-xs font-medium border transition-colors ${
                    on ? "bg-section text-white border-section" : "border-line2 text-ink2 hover:bg-surface2"
                  }`}>
                  {name}
                </button>
              );
            })}
          </div>
        </FormField>

        <FormField label="Copie invisible"
          hint="Adresse interne qui reçoit une copie de chaque relance. Le client ne la voit pas.">
          <input type="email" className={inputCls} value={form.bccEmail} placeholder="compta@exemple.ne"
            onChange={e => setForm(f => ({ ...f, bccEmail: e.target.value }))} />
        </FormField>

        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.respectDisputes} className="mt-0.5"
            onChange={e => setForm(f => ({ ...f, respectDisputes: e.target.checked }))} />
          <span>
            <span className="text-sm text-ink">Suspendre les relances sur les factures en litige</span>
            <span className="block text-xs text-ink2 mt-0.5">
              Réclamer une facture que le client conteste transforme un désaccord sur une
              ligne en conflit sur la relation.
            </span>
          </span>
        </label>

        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}

        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button type="button" onClick={onClose}
            className={buttonClass("secondary", "md")}>
            Annuler
          </button>
          <button type="submit" disabled={saving}
            className={buttonClass("primary", "md")}>
            <CheckCircle2 size={15} /> {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
