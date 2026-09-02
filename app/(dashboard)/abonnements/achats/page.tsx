"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { fullXof } from "@/components/ui/charts/geometry";
import { RETENUES_DETAILLEES } from "@/lib/niger-fiscal";

interface Purchase {
  _id: string;
  reference: string;
  productName: string;
  vendorContractRef?: string;
  supplierId?: { _id: string; name: string } | string;
  startDate: string;
  endDate: string;
  quantity: number;
  unitLabel?: string;
  currency: string;
  sourceAmount: number;
  exchangeRate: number;
  costAmount: number;
  withholdingAmount?: number;
  status: string;
  autoRenew?: boolean;
}

interface Supplier { _id: string; name: string; }

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon", active: "En cours", expiring: "À renouveler",
  expired: "Expiré", cancelled: "Annulé",
};
const STATUS_STYLE: Record<string, string> = {
  draft: "bg-line text-ink2", active: "bg-pos-50 text-pos",
  expiring: "bg-warn-50 text-warn", expired: "bg-neg-50 text-neg",
  cancelled: "bg-line text-ink3",
};

const EMPTY = {
  reference: "", supplierId: "", productName: "", vendorContractRef: "",
  startDate: "", endDate: "", billingCycle: "annual",
  quantity: 1, unitLabel: "licence",
  currency: "XOF", sourceAmount: 0, exchangeRate: 1,
  withholdingAmount: "", purchaseVatAmount: 0, bankFeesAmount: 0,
  autoRenew: false, noticeDays: 30, notes: "",
};

export default function AchatsAbonnementsPage() {
  const [items, setItems] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (status) params.set("status", status);
    fetch(`/api/abonnements/achats?${params}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => setItems(d.data?.items || []))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/suppliers?limit=200", { credentials: "include" })
      .then(r => r.json())
      .then(d => setSuppliers(d.data?.items || []))
      .catch(() => setSuppliers([]));
  }, []);

  // La contre-valeur est montrée en direct : l'utilisateur voit ce qui sera
  // figé en base avant d'enregistrer, plutôt que de le découvrir après.
  const costPreview = Math.round((Number(form.sourceAmount) || 0) * (Number(form.exchangeRate) || 0));
  const suggestedWithholding = form.currency !== "XOF"
    ? Math.round(costPreview * RETENUES_DETAILLEES.prestation_service.taux)
    : 0;

  function update<K extends keyof typeof EMPTY>(field: K, value: (typeof EMPTY)[K]) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const res = await fetch("/api/abonnements/achats", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          withholdingAmount: form.withholdingAmount === "" ? undefined : Number(form.withholdingAmount),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Enregistrement refusé");
      setOpen(false);
      setForm({ ...EMPTY });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/abonnements" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
            <ArrowLeft size={13} /> Abonnements
          </Link>
          <h1 className="text-2xl font-bold text-ink mt-1">Contrats souscrits</h1>
          <p className="text-sm text-ink2">
            Ce que l&apos;organisation achète aux éditeurs, et qui alimente les reventes.
          </p>
        </div>
        <button onClick={() => setOpen(true)}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Nouveau contrat
        </button>
      </div>

      <SegmentedControl
        ariaLabel="Filtrer par statut"
        segments={[
          { value: "", label: "Tous" },
          { value: "active", label: "En cours" },
          { value: "expiring", label: "À renouveler" },
          { value: "expired", label: "Expirés" },
          { value: "draft", label: "Brouillons" },
        ]}
        value={status}
        onChange={setStatus}
        size="sm"
      />

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-dense min-w-[54rem]">
            <thead>
              <tr>
                {["Référence", "Produit", "Fournisseur", "Période", "Quantité", "Coût (XOF)", "Statut"].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="py-10 text-center text-ink3">Chargement…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-ink3">Aucun contrat souscrit</td></tr>
              )}
              {items.map(item => {
                const supplier = typeof item.supplierId === "object" ? item.supplierId?.name : "—";
                return (
                  <tr key={item._id}>
                    <td className="font-mono text-xs text-section">{item.reference}</td>
                    <td>
                      <p className="text-ink font-medium">{item.productName}</p>
                      {item.vendorContractRef && (
                        <p className="text-[11px] text-ink3 font-mono">{item.vendorContractRef}</p>
                      )}
                    </td>
                    <td className="text-ink2">{supplier}</td>
                    <td className="text-ink2 whitespace-nowrap text-xs">
                      {new Date(item.startDate).toLocaleDateString("fr-FR")} →{" "}
                      {new Date(item.endDate).toLocaleDateString("fr-FR")}
                      {item.autoRenew && <span className="ml-1 text-[10px] text-warn">tacite</span>}
                    </td>
                    <td className="num text-ink2">
                      {item.quantity} {item.unitLabel || "licence"}(s)
                    </td>
                    <td>
                      <p className="num text-ink font-medium">{fullXof(item.costAmount)}</p>
                      {item.currency !== "XOF" && (
                        <p className="text-[11px] text-ink3 num">
                          {item.sourceAmount.toLocaleString("fr-FR")} {item.currency} × {item.exchangeRate}
                        </p>
                      )}
                    </td>
                    <td>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[item.status] || "bg-line text-ink2"}`}>
                        {STATUS_LABEL[item.status] || item.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau contrat souscrit" size="xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="px-3 py-2 bg-neg-50 border border-neg/25 rounded-lg text-sm text-neg">{error}</p>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label="Référence interne" required>
              <input className={inputCls} value={form.reference} required
                placeholder="ABO-2026-001"
                onChange={e => update("reference", e.target.value)} />
            </FormField>
            <FormField label="Fournisseur / éditeur" required>
              <select className={selectCls} value={form.supplierId} required
                onChange={e => update("supplierId", e.target.value)}>
                <option value="">Choisir…</option>
                {suppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label="Produit" required hint="Nom commercial chez l'éditeur">
              <input className={inputCls} value={form.productName} required
                placeholder="Compilatio Magister+"
                onChange={e => update("productName", e.target.value)} />
            </FormField>
            <FormField label="Référence du contrat éditeur" hint="Pour le rapprochement">
              <input className={inputCls} value={form.vendorContractRef}
                onChange={e => update("vendorContractRef", e.target.value)} />
            </FormField>
          </div>

          <div className="grid sm:grid-cols-4 gap-4">
            <FormField label="Début" required>
              <input type="date" className={inputCls} value={form.startDate} required
                onChange={e => update("startDate", e.target.value)} />
            </FormField>
            <FormField label="Fin" required>
              <input type="date" className={inputCls} value={form.endDate} required
                onChange={e => update("endDate", e.target.value)} />
            </FormField>
            <FormField label="Quantité" required>
              <input type="number" min={1} className={inputCls} value={form.quantity} required
                onChange={e => update("quantity", Number(e.target.value))} />
            </FormField>
            <FormField label="Unité">
              <input className={inputCls} value={form.unitLabel}
                onChange={e => update("unitLabel", e.target.value)} />
            </FormField>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <FormField label="Devise">
              <select className={selectCls} value={form.currency}
                onChange={e => {
                  update("currency", e.target.value);
                  if (e.target.value === "XOF") update("exchangeRate", 1);
                }}>
                <option value="XOF">XOF</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </FormField>
            <FormField label={`Montant (${form.currency})`} required>
              <input type="number" min={0} step="0.01" className={inputCls} value={form.sourceAmount} required
                onChange={e => update("sourceAmount", Number(e.target.value))} />
            </FormField>
            <FormField label="Taux de change"
              hint={form.currency === "XOF" ? "Sans objet" : "Taux appliqué au règlement"}>
              <input type="number" min={0} step="0.0001" className={inputCls}
                value={form.exchangeRate} disabled={form.currency === "XOF"}
                onChange={e => update("exchangeRate", Number(e.target.value))} />
            </FormField>
          </div>

          <div className="rounded-lg bg-section-soft border border-section/20 px-4 py-3">
            <p className="text-xs text-ink2">Contre-valeur figée à l&apos;enregistrement</p>
            <p className="text-lg font-bold text-ink num">{fullXof(costPreview)}</p>
            {suggestedWithholding > 0 && (
              <p className="text-[11px] text-ink2 mt-1">
                Retenue à la source suggérée sur prestataire étranger&nbsp;:{" "}
                <strong className="num">{fullXof(suggestedWithholding)}</strong>{" "}
                ({RETENUES_DETAILLEES.prestation_service.article}, 5 %). Modifiable ci-dessous.
              </p>
            )}
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <FormField label="Retenue à la source (XOF)"
              hint={suggestedWithholding > 0 ? "Vide = valeur suggérée" : "Le cas échéant"}>
              <input type="number" min={0} className={inputCls} value={form.withholdingAmount}
                placeholder={suggestedWithholding ? String(suggestedWithholding) : "0"}
                onChange={e => update("withholdingAmount", e.target.value)} />
            </FormField>
            <FormField label="TVA supportée (XOF)" hint="Déductible, hors coût de revient">
              <input type="number" min={0} className={inputCls} value={form.purchaseVatAmount}
                onChange={e => update("purchaseVatAmount", Number(e.target.value))} />
            </FormField>
            <FormField label="Frais bancaires (XOF)" hint="Transfert international">
              <input type="number" min={0} className={inputCls} value={form.bankFeesAmount}
                onChange={e => update("bankFeesAmount", Number(e.target.value))} />
            </FormField>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 items-end">
            <FormField label="Périodicité">
              <select className={selectCls} value={form.billingCycle}
                onChange={e => update("billingCycle", e.target.value)}>
                <option value="monthly">Mensuelle</option>
                <option value="quarterly">Trimestrielle</option>
                <option value="biannual">Semestrielle</option>
                <option value="annual">Annuelle</option>
                <option value="one_off">Ponctuelle</option>
              </select>
            </FormField>
            <FormField label="Préavis (jours)" hint="Pour l'alerte de dénonciation">
              <input type="number" min={0} className={inputCls} value={form.noticeDays}
                onChange={e => update("noticeDays", Number(e.target.value))} />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-ink2 h-10">
              <input type="checkbox" checked={form.autoRenew}
                onChange={e => update("autoRenew", e.target.checked)} />
              Reconduction tacite
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-line">
            <button type="button" onClick={() => setOpen(false)}
              className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
