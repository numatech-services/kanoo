"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Link2, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { fullXof } from "@/components/ui/charts/geometry";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
interface Sale {
  _id: string;
  reference: string;
  productName: string;
  clientId?: { _id: string; name: string } | string;
  purchaseId?: { _id: string; reference: string; productName: string; endDate: string } | string;
  startDate: string;
  endDate: string;
  quantity: number;
  unitPrice: number;
  totalHT: number;
  totalTTC: number;
  status: string;
  invoiceId?: string;
}

interface Client { _id: string; name: string; }
interface PurchaseOption {
  _id: string; reference: string; productName: string;
  endDate: string; startDate: string; quantity: number;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon", active: "En cours", expiring: "À renouveler",
  expired: "Expirée", cancelled: "Annulée", renewed: "Renouvelée",
};
const STATUS_STYLE: Record<string, string> = {
  draft: "bg-line text-ink2", active: "bg-pos-50 text-pos",
  expiring: "bg-warn-50 text-warn", expired: "bg-neg-50 text-neg",
  cancelled: "bg-line text-ink3", renewed: "bg-info-50 text-info",
};

const EMPTY = {
  reference: "", clientId: "", purchaseId: "", productName: "",
  startDate: "", endDate: "", billingCycle: "annual",
  quantity: 1, unitPrice: 0, tvaRate: TVA_TAUX_STANDARD,
  withholdingAmount: 0, autoRenew: false, notes: "",
};

export default function ReventesPage() {
  const [items, setItems] = useState<Sale[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (filter === "unbilled") params.set("unbilled", "true");
    else if (filter) params.set("status", filter);
    apiJson(`/api/abonnements/reventes?${params}`)
      .then(d => setItems(d.data?.items || []))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiJson("/api/clients?limit=200").then(d => setClients(d.data?.items || [])).catch(() => setClients([]));
    apiJson("/api/abonnements/achats?limit=200&status=active").then(d => setPurchases(d.data?.items || [])).catch(() => setPurchases([]));
  }, []);

  const selectedPurchase = purchases.find(p => p._id === form.purchaseId);
  const totalHT = Math.round((Number(form.quantity) || 0) * (Number(form.unitPrice) || 0));
  const totalTVA = calculerTVA(totalHT, Number(form.tvaRate) || 0);

  function update<K extends keyof typeof EMPTY>(field: K, value: (typeof EMPTY)[K]) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  /** Rattacher un contrat pré-remplit période et intitulé : moins de saisie, moins d'écarts. */
  function attachPurchase(id: string) {
    const purchase = purchases.find(p => p._id === id);
    setForm(prev => ({
      ...prev,
      purchaseId: id,
      productName: prev.productName || purchase?.productName || "",
      startDate: prev.startDate || purchase?.startDate?.slice(0, 10) || "",
      endDate: prev.endDate || purchase?.endDate?.slice(0, 10) || "",
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend("POST", "/api/abonnements/reventes", { ...form, purchaseId: form.purchaseId || undefined });
      const d = res.data;
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
          <h1 className="page-title mt-1">Licences : reventes</h1>
          <p className="text-sm text-ink2">
            Ce qui est placé chez les clients finaux, adossé aux contrats souscrits.
          </p>
        </div>
        <button onClick={() => setOpen(true)}
          className={buttonClass("primary", "md")}>
          <Plus size={16} /> Nouvelle revente
        </button>
      </div>

      <SegmentedControl
        ariaLabel="Filtrer"
        segments={[
          { value: "", label: "Toutes" },
          { value: "active", label: "En cours" },
          { value: "unbilled", label: "Non facturées" },
          { value: "expired", label: "Expirées" },
        ]}
        value={filter}
        onChange={setFilter}
        size="sm"
      />

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-dense min-w-[56rem]">
            <thead>
              <tr>
                {["Référence", "Client", "Produit", "Contrat amont", "Période", "Montant HT", "Statut"].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="py-10 text-center text-ink3">Chargement…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-ink3">Aucune revente</td></tr>
              )}
              {items.map(item => {
                const client = typeof item.clientId === "object" ? item.clientId?.name : "—";
                const purchase = typeof item.purchaseId === "object" ? item.purchaseId : null;
                return (
                  <tr key={item._id}>
                    <td>
                      <p className="font-mono text-xs text-section">{item.reference}</p>
                      {!item.invoiceId && item.status === "active" && (
                        <span className="text-[10px] text-warn">non facturée</span>
                      )}
                    </td>
                    <td className="text-ink font-medium">{client}</td>
                    <td className="text-ink2">{item.productName}</td>
                    <td>
                      {purchase ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink2">
                          <Link2 size={11} /> {purchase.reference}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-warn">
                          <AlertTriangle size={11} /> non adossée
                        </span>
                      )}
                    </td>
                    <td className="text-ink2 whitespace-nowrap text-xs">
                      {new Date(item.startDate).toLocaleDateString("fr-FR")} →{" "}
                      {new Date(item.endDate).toLocaleDateString("fr-FR")}
                    </td>
                    <td>
                      <p className="num text-ink font-medium">{fullXof(item.totalHT)}</p>
                      <p className="text-[11px] text-ink3 num">
                        {item.quantity} × {item.unitPrice.toLocaleString("fr-FR")}
                      </p>
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

      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle revente" size="xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="px-3 py-2 bg-neg-50 border border-neg/25 rounded-lg text-sm text-neg">{error}</p>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label="Référence" required>
              <input className={inputCls} value={form.reference} required
                placeholder="REV-2026-001"
                onChange={e => update("reference", e.target.value)} />
            </FormField>
            <FormField label="Client final" required>
              <select className={selectCls} value={form.clientId} required
                onChange={e => update("clientId", e.target.value)}>
                <option value="">Choisir…</option>
                {clients.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </FormField>
          </div>

          <FormField label="Contrat souscrit à consommer"
            hint="Laisser vide pour une prestation vendue sans contrat amont — elle sera signalée dans le rapprochement.">
            <select className={selectCls} value={form.purchaseId}
              onChange={e => attachPurchase(e.target.value)}>
              <option value="">Aucun — revente non adossée</option>
              {purchases.map(p => (
                <option key={p._id} value={p._id}>
                  {p.reference} — {p.productName} (jusqu&apos;au {new Date(p.endDate).toLocaleDateString("fr-FR")})
                </option>
              ))}
            </select>
          </FormField>

          {selectedPurchase && (
            <p className="text-xs text-ink2 bg-section-soft border border-section/20 rounded-lg px-3 py-2">
              La période vendue doit rester dans celle du contrat&nbsp;:{" "}
              {new Date(selectedPurchase.startDate).toLocaleDateString("fr-FR")} →{" "}
              {new Date(selectedPurchase.endDate).toLocaleDateString("fr-FR")}. Le serveur
              refuse toute revente qui la dépasse ou qui excède les licences restantes.
            </p>
          )}

          <FormField label="Intitulé pour le client" required>
            <input className={inputCls} value={form.productName} required
              onChange={e => update("productName", e.target.value)} />
          </FormField>

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
            <FormField label="Prix unitaire HT" required>
              <input type="number" min={0} className={inputCls} value={form.unitPrice} required
                onChange={e => update("unitPrice", Number(e.target.value))} />
            </FormField>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <FormField label="Taux de TVA">
              <select className={selectCls} value={String(form.tvaRate)}
                onChange={e => update("tvaRate", Number(e.target.value))}>
                <option value="0.19">19 % — taux normal</option>
                <option value="0.1">10 % — taux réduit</option>
                <option value="0">0 % — exonéré</option>
              </select>
            </FormField>
            <FormField label="Retenue à la source (FCFA)" hint="Opérée par le client, le cas échéant">
              <input type="number" min={0} className={inputCls} value={form.withholdingAmount}
                onChange={e => update("withholdingAmount", Number(e.target.value))} />
            </FormField>
            <div className="rounded-lg bg-surface2 border border-line px-3 py-2">
              <p className="text-[11px] text-ink2">Total</p>
              <p className="num font-bold text-ink">{fullXof(totalHT + totalTVA)}</p>
              <p className="text-[11px] text-ink3 num">
                {fullXof(totalHT)} HT + {fullXof(totalTVA)} TVA
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-line">
            <button type="button" onClick={() => setOpen(false)}
              className={buttonClass("secondary", "md")}>
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className={buttonClass("primary", "md")}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
