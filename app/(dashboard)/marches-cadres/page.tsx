"use client";

import { ClientFilterChip } from "@/components/shared/ClientFilterChip";
import { useUrlReady } from "@/lib/url-param";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, PackageCheck, ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { EmptyState, StatStrip } from "@/components/ui/Primitives";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { fullXof, compactXof } from "@/components/ui/charts/geometry";
import { orderProgress } from "@/lib/framework-order";

import { buttonClass } from "@/components/ui/button-class";
interface Order {
  _id: string; reference: string; title: string; unit: string;
  clientId?: { name?: string }; totalQuantity: number; deliveredQuantity?: number;
  invoicedQuantity?: number; unitPrice: number; tvaRate?: number; status: string;
}
interface Client { _id: string; name: string }

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}

export default function MarchesCadresPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const ready = useUrlReady(p => setClientId(p.get("clientId") ?? ""));
  const load = useCallback(() => {
    if (!ready) return;
    fetch(`/api/marches-cadres?limit=100${clientId ? `&clientId=${clientId}` : ""}`, { credentials: "include" })
      .then(r => r.json()).then(d => setOrders(d.data?.items || []))
      .catch(() => setError("Lecture impossible.")).finally(() => setLoading(false));
  }, [clientId, ready]);
  useEffect(() => { load(); }, [load]);

  const active = orders.filter(o => o.status === "active").length;
  const totalRemainingValue = orders.reduce((s, o) => s + orderProgress(o).remainingValueTTC, 0);

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1 className="page-title">Marchés-cadres</h1>
          <p className="text-sm text-ink2">
            Une quantité commandée, livrée par lots au fil de l&apos;année, facturée à chaque livraison.
          </p>
        </div>
        <button onClick={() => setOpen(true)}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95">
          <Plus size={16} /> Nouveau marché
        </button>
      </div>

      {clientId && <ClientFilterChip name={((orders[0]?.clientId as { name?: string } | undefined)?.name)} onClear={() => setClientId("")} />}
      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      {orders.length > 0 && (
        <StatStrip items={[
          { label: "Marchés actifs", value: String(active), tone: "recurring" },
          { label: "Reste à livrer (valeur)", value: compactXof(totalRemainingValue), tone: "pending" },
          { label: "Marchés au total", value: String(orders.length), tone: "parties" },
        ]} />
      )}

      {loading ? (
        <div className="h-64 surface-card animate-pulse" />
      ) : orders.length === 0 ? (
        <EmptyState icon={<PackageCheck size={20} />} title="Aucun marché-cadre"
          hint="Créez-en un : quantité annuelle, prix, période — puis livrez par lots."
          action={{ label: "Nouveau marché", href: "#" }} />
      ) : (
        <div className="grid gap-3">
          {orders.map(o => {
            const p = orderProgress(o);
            return (
              <Link key={o._id} href={`/marches-cadres/${o._id}`}
                className="surface-card p-4 lift block hover:border-section">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{o.title}</p>
                    <p className="text-xs text-ink3">{o.reference} · {o.clientId?.name}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-ink2 mb-1">
                    <span>Livré {p.delivered} / {o.totalQuantity} {o.unit}</span>
                    <span className="num">{p.deliveredPct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface2 overflow-hidden relative">
                    <span className="absolute inset-y-0 left-0 bg-section/40 rounded-full" style={{ width: `${p.deliveredPct}%` }} />
                    <span className="absolute inset-y-0 left-0 bg-section rounded-full" style={{ width: `${p.invoicedPct}%` }} title="Facturé" />
                  </div>
                  <div className="flex justify-between text-[11px] text-ink3 mt-1">
                    <span>Facturé {p.invoicedPct}%</span>
                    <span>Reste à livrer : {fullXof(p.remainingValueTTC)}</span>
                  </div>
                </div>
                <span className="mt-2 text-xs font-medium text-section inline-flex items-center gap-1">
                  Ouvrir <ArrowRight size={12} />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <CreateDialog open={open} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); load(); }} />
    </div>
  );
}

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Array<{ _id: string; label: string; stockQty?: number }>>([]);
  const [form, setForm] = useState({
    clientId: "", title: "", totalQuantity: "", unitPrice: "", tvaRate: "0.19",
    unit: "unité", startDate: "", endDate: "", inputProductId: "", inputPerUnit: "1", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/marches-cadres/clients", { credentials: "include" }).then(r => r.json()).then(d => setClients(d.data?.items || [])).catch(() => {});
    fetch("/api/products?limit=200", { credentials: "include" }).then(r => r.json()).then(d => setProducts(d.data?.items || [])).catch(() => {});
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/marches-cadres", {
        method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          totalQuantity: Number(form.totalQuantity), unitPrice: Number(form.unitPrice),
          tvaRate: Number(form.tvaRate), inputPerUnit: Number(form.inputPerUnit),
          inputProductId: form.inputProductId || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Création refusée");
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau marché-cadre" size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Client" required>
            <select className={selectCls} value={form.clientId} required onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}>
              <option value="">— Choisir —</option>
              {clients.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </FormField>
          <FormField label="Intitulé" required>
            <input className={inputCls} value={form.title} required placeholder="Cartes étudiantes 2026"
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </FormField>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <FormField label="Quantité totale" required>
            <input type="number" min={1} className={inputCls} value={form.totalQuantity} required
              onChange={e => setForm(f => ({ ...f, totalQuantity: e.target.value }))} />
          </FormField>
          <FormField label="Unité">
            <input className={inputCls} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
          </FormField>
          <FormField label="Prix unitaire (FCFA)" required>
            <input type="number" min={0} className={inputCls} value={form.unitPrice} required
              onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} />
          </FormField>
          <FormField label="TVA">
            <select className={selectCls} value={form.tvaRate} onChange={e => setForm(f => ({ ...f, tvaRate: e.target.value }))}>
              <option value="0.19">19 %</option><option value="0">0 %</option>
            </select>
          </FormField>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Début de période"><input type="date" className={inputCls} value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></FormField>
          <FormField label="Fin de période"><input type="date" className={inputCls} value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></FormField>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Intrant consommé" hint="Stock décrémenté à chaque livraison (ex. numéros ISIC). Facultatif.">
            <select className={selectCls} value={form.inputProductId} onChange={e => setForm(f => ({ ...f, inputProductId: e.target.value }))}>
              <option value="">— Aucun —</option>
              {products.map(p => <option key={p._id} value={p._id}>{p.label}{p.stockQty !== undefined ? ` (stock ${p.stockQty})` : ""}</option>)}
            </select>
          </FormField>
          <FormField label="Intrant par unité" hint="Ex. 1 numéro ISIC par carte.">
            <input type="number" min={0} step="0.1" className={inputCls} value={form.inputPerUnit}
              onChange={e => setForm(f => ({ ...f, inputPerUnit: e.target.value }))} />
          </FormField>
        </div>
        <div className="flex justify-end gap-3 pt-2 border-t border-line">
          <button type="button" onClick={onClose} className={buttonClass("secondary", "md")}>Annuler</button>
          <button type="submit" disabled={saving} className={buttonClass("primary", "md")}>
            {saving ? "Création…" : "Créer le marché"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
