"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Plus, EyeOff, TrendingDown, TrendingUp, Target, Trash2 } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Pill, Inset, EmptyState } from "@/components/ui/Primitives";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, textareaCls } from "@/components/ui/FormField";
import { fullXof } from "@/components/ui/charts/geometry";
import { COUNT_STATUS_LABEL, type CountStatus } from "@/lib/inventory";
import { useMe, meCanDo } from "@/lib/useMe";

interface Session {
  _id: string;
  reference: string;
  label: string;
  status: CountStatus;
  blind: boolean;
  location?: string;
  openedAt?: string;
  validatedAt?: string;
  shortageValue?: number;
  surplusValue?: number;
  accuracy?: number;
  createdBy?: { firstName?: string; lastName?: string };
}

const STATUS_TONE: Record<CountStatus, "pos" | "warn" | "info" | "neg" | "mute"> = {
  draft: "mute", counting: "info", review: "warn", validated: "pos", cancelled: "mute",
};

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}

export default function InventairesPage() {
  // Suppression réservée au chef de service et au gérant (masquée sinon ; l'API refuse de toute façon).
  const canDelete = meCanDo(useMe(), "products", "delete");
  const [items, setItems] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/inventaires", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setItems(d.data.items || []);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    if (!confirm("Supprimer cette session d'inventaire ?")) return;
    const res = await fetch(`/api/inventaires/${id}`, {
      method: "DELETE", credentials: "include",
      headers: { "x-csrf-token": await csrf() },
    });
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); alert(d.error || "Suppression impossible."); }
  }

  const running = items.find(s => ["draft", "counting", "review"].includes(s.status));
  const validated = items.filter(s => s.status === "validated");
  const last = validated[0];

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="text-2xl font-bold text-ink">Inventaires physiques</h1>
          <p className="text-sm text-ink2">
            Compter ce qu&apos;il y a réellement, expliquer l&apos;écart, le porter en
            comptabilité.
          </p>
        </div>
        <button onClick={() => setOpen(true)} disabled={Boolean(running)}
          title={running ? "Un inventaire est déjà ouvert" : undefined}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
          <Plus size={16} /> Ouvrir un inventaire
        </button>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      {running && (
        <Link href={`/inventaires/${running._id}`}
          className="block px-4 py-4 rounded-xl bg-info-50 border border-info/25 hover:bg-info-50/70 transition-colors">
          <p className="text-sm font-medium text-info flex items-center gap-2">
            <ClipboardList size={16} />
            {running.label} — {COUNT_STATUS_LABEL[running.status]}
            {running.blind && <Pill tone="info" icon={<EyeOff size={11} />}>Aveugle</Pill>}
          </p>
          <p className="text-xs text-ink2 mt-1">
            Ouvert le {running.openedAt ? new Date(running.openedAt).toLocaleDateString("fr-FR") : "—"}.
            Reprendre le comptage →
          </p>
        </Link>
      )}

      {last && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard label="Fiabilité du dernier inventaire"
            value={last.accuracy !== undefined ? `${last.accuracy} %` : "—"}
            icon={<Target size={17} />}
            tone={(last.accuracy ?? 0) >= 95 ? "margin" : "pending"}
            hint="Part des articles comptés sans écart" />
          <KpiCard label="Manquants" value={last.shortageValue ?? 0} format={fullXof}
            icon={<TrendingDown size={17} />} tone="neg" goodDirection="down"
            hint="Valorisés au coût, pas au prix de vente" />
          <KpiCard label="Excédents" value={last.surplusValue ?? 0} format={fullXof}
            icon={<TrendingUp size={17} />} tone="volume"
            hint="Ne compensent pas les manquants" />
        </div>
      )}

      {loading ? (
        <div className="surface-card p-6 space-y-3">
          {[0, 1].map(i => <div key={i} className="h-14 rounded-lg bg-surface2 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={20} />}
          title="Aucun inventaire"
          hint="À l'ouverture, le stock théorique est photographié : une vente saisie pendant le comptage ne viendra pas fausser les écarts."
        />
      ) : (
        <section className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dense min-w-[52rem]">
              <thead>
                <tr>
                  <th>Référence</th><th>Intitulé</th><th>Ouvert le</th>
                  <th className="text-right">Manquants</th><th className="text-right">Excédents</th>
                  <th className="text-right">Fiabilité</th><th>État</th>
                </tr>
              </thead>
              <tbody>
                {items.map(session => (
                  <tr key={session._id}>
                    <td>
                      <Link href={`/inventaires/${session._id}`}
                        className="font-mono text-xs text-section hover:underline">
                        {session.reference}
                      </Link>
                    </td>
                    <td className="text-ink">
                      {session.label}
                      {session.location && (
                        <span className="block text-[11px] text-ink3">{session.location}</span>
                      )}
                    </td>
                    <td className="text-ink2 text-xs whitespace-nowrap">
                      {session.openedAt ? new Date(session.openedAt).toLocaleDateString("fr-FR") : "—"}
                    </td>
                    <td className="num text-right text-neg">
                      {session.shortageValue !== undefined ? fullXof(session.shortageValue) : "—"}
                    </td>
                    <td className="num text-right text-pos">
                      {session.surplusValue !== undefined ? fullXof(session.surplusValue) : "—"}
                    </td>
                    <td className="num text-right text-ink">
                      {session.accuracy !== undefined ? `${session.accuracy} %` : "—"}
                    </td>
                    <td>
                      <div className="flex items-center justify-between gap-2">
                        <Pill tone={STATUS_TONE[session.status]}>
                          {COUNT_STATUS_LABEL[session.status]}
                        </Pill>
                        {session.status !== "validated" && canDelete && (
                          <button onClick={() => remove(session._id)} className="text-ink3 hover:text-neg" title="Supprimer cet inventaire">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <OpenDialog open={open} onClose={() => setOpen(false)}
        onOpened={() => { setOpen(false); load(); }} />
    </div>
  );
}

function OpenDialog({
  open, onClose, onOpened,
}: { open: boolean; onClose: () => void; onOpened: () => void }) {
  const [form, setForm] = useState({
    label: "", location: "", blind: true,
    recountThresholdQty: 10, reasonThresholdValue: 50_000, notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ lines: number; unvalued: number } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/inventaires", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Ouverture refusée");
      setResult({ lines: d.data.lines, unvalued: d.data.unvalued });
      onOpened();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ouverture impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ouvrir un inventaire" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Intitulé" required
          hint="« Inventaire dépôt Niamey, septembre » se retrouve ; « Inventaire 3 » non.">
          <input className={inputCls} value={form.label} required autoFocus
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        </FormField>

        <FormField label="Lieu">
          <input className={inputCls} value={form.location} placeholder="Dépôt central, magasin…"
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
        </FormField>

        <label className="flex items-start gap-3 p-3 rounded-lg border border-line2 cursor-pointer">
          <input type="checkbox" checked={form.blind} className="mt-0.5"
            onChange={e => setForm(f => ({ ...f, blind: e.target.checked }))} />
          <span>
            <span className="text-sm font-medium text-ink">Comptage aveugle</span>
            <span className="block text-xs text-ink2 mt-0.5">
              La quantité théorique n&apos;est montrée à personne pendant le comptage —
              et ne quitte même pas le serveur. Devant « théorique&nbsp;48 », on compte
              48&nbsp;: l&apos;écart réel disparaît, et avec lui la seule raison de faire
              l&apos;inventaire.
            </span>
          </span>
        </label>

        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Second comptage au-delà de"
            hint="Écart en unités déclenchant une vérification.">
            <input type="number" min={1} className={inputCls} value={form.recountThresholdQty}
              onChange={e => setForm(f => ({ ...f, recountThresholdQty: Number(e.target.value) }))} />
          </FormField>
          <FormField label="Motif exigé au-delà de (XOF)"
            hint="Une régularisation sans explication est incontestable le jour où l'on en a besoin.">
            <input type="number" min={0} className={inputCls} value={form.reasonThresholdValue}
              onChange={e => setForm(f => ({ ...f, reasonThresholdValue: Number(e.target.value) }))} />
          </FormField>
        </div>

        <FormField label="Notes">
          <textarea className={textareaCls} rows={2} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </FormField>

        <Inset tone="info">
          À l&apos;ouverture, le stock théorique et le coût unitaire sont figés article
          par article. Sans cette photographie, une vente saisie pendant le comptage
          transformerait un stock juste en écart.
        </Inset>

        {result && (
          <Inset tone={result.unvalued > 0 ? "warn" : "pos"}>
            {result.lines} article(s) à compter.
            {result.unvalued > 0 && (
              <> {result.unvalued} sans historique d&apos;achat valorisé : leur écart sera
              compté en quantité mais pas en valeur. Renseigner un coût d&apos;entrée les
              fera entrer dans l&apos;écriture.</>
            )}
          </Inset>
        )}

        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}

        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <button type="button" onClick={onClose}
            className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
            Fermer
          </button>
          <button type="submit" disabled={saving || !form.label.trim()}
            className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
            {saving ? "Ouverture…" : "Ouvrir et photographier le stock"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
