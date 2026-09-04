"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, FileText, Truck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls } from "@/components/ui/FormField";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Inset } from "@/components/ui/Primitives";
import { fullXof } from "@/components/ui/charts/geometry";
import { orderProgress, canDeliver, lotTotals } from "@/lib/framework-order";

interface Order {
  _id: string; reference: string; title: string; unit: string; status: string;
  totalQuantity: number; deliveredQuantity?: number; invoicedQuantity?: number;
  unitPrice: number; tvaRate?: number; startDate?: string; endDate?: string;
  clientId?: { name?: string; nif?: string }; inputProductId?: { label?: string; stockQty?: number };
  inputPerUnit?: number; notes?: string;
}
interface Lot {
  _id: string; reference: string; date: string; quantity: number;
  status: string; invoiceId?: string; inputConsumed?: number;
}

async function csrf() {
  const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
  return csrfToken as string;
}

export default function MarcheDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/marches-cadres/${id}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (!d.success) throw new Error(d.error); setOrder(d.data.order); setLots(d.data.lots || []); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function invoiceLot(lot: Lot) {
    setBusy(lot._id); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/marches-cadres/${id}/lots/${lot._id}/facturer`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include", body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Facturation refusée");
      setNotice(`Facture ${d.data.number} créée pour le lot ${lot.reference}.`);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Facturation impossible"); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="h-96 surface-card animate-pulse" />;
  if (!order) return <p className="p-4 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error || "Marché introuvable."}</p>;

  const p = orderProgress(order);

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <Link href="/marches-cadres" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
            <ArrowLeft size={13} /> Marchés-cadres
          </Link>
          <h1 className="text-2xl font-bold text-ink mt-1">{order.title}</h1>
          <p className="text-sm text-ink2">{order.reference} · {order.clientId?.name} · <StatusBadge status={order.status} /></p>
        </div>
        <button onClick={() => setDeliverOpen(true)} disabled={p.toDeliver <= 0}
          className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
          <Truck size={16} /> Livrer un lot
        </button>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}
      {notice && <p className="px-4 py-3 bg-pos-50 border border-pos/25 rounded-xl text-sm text-pos">{notice}</p>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Commandé" value={order.totalQuantity} tone="parties" hint={`${order.unit} · ${fullXof(order.unitPrice)}/u`} />
        <KpiCard label="Livré" value={p.delivered} tone="section" hint={`${p.deliveredPct}% · reste ${p.toDeliver}`} />
        <KpiCard label="Facturé" value={p.invoiced} tone="revenue" hint={`${p.invoicedPct}% · ${p.toInvoice} à facturer`} />
        <KpiCard label="Reste à livrer (valeur)" value={p.remainingValueTTC} format="xof" tone="pending" />
      </div>

      {order.inputProductId && (
        <Inset tone={(order.inputProductId.stockQty ?? 0) < p.toDeliver * (order.inputPerUnit ?? 1) ? "warn" : "info"}>
          Intrant : <strong>{order.inputProductId.label}</strong> — stock {order.inputProductId.stockQty ?? 0}.
          Chaque livraison en consomme {order.inputPerUnit ?? 1} par {order.unit}.
        </Inset>
      )}

      <section className="surface-card overflow-hidden">
        <div className="p-5 pb-3"><h2 className="font-semibold text-ink">Lots livrés</h2></div>
        <div className="overflow-x-auto">
          <table className="table-dense">
            <thead><tr><th>Référence</th><th>Date</th><th>Quantité</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {lots.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-ink3">Aucun lot livré.</td></tr>}
              {lots.map(l => (
                <tr key={l._id}>
                  <td className="text-ink font-medium">{l.reference}</td>
                  <td className="text-ink2 whitespace-nowrap">{new Date(l.date).toLocaleDateString("fr-FR")}</td>
                  <td className="num">{l.quantity} {order.unit}</td>
                  <td><StatusBadge status={l.status === "invoiced" ? "paid" : "active"} label={l.status === "invoiced" ? "Facturé" : "Livré"} /></td>
                  <td>
                    <span className="flex justify-end">
                      {l.status === "invoiced" ? (
                        <Link href={`/invoices/${l.invoiceId}`} className="text-xs text-section hover:underline inline-flex items-center gap-1">
                          <FileText size={13} /> Facture
                        </Link>
                      ) : (
                        <button onClick={() => invoiceLot(l)} disabled={busy === l._id}
                          className="px-2.5 py-1 rounded bg-section text-white text-xs font-medium hover:brightness-95 disabled:opacity-50">
                          {busy === l._id ? "…" : "Facturer"}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <DeliverDialog open={deliverOpen} onClose={() => setDeliverOpen(false)} order={order}
        onDone={() => { setDeliverOpen(false); load(); }} />
    </div>
  );
}

function DeliverDialog({ open, onClose, order, onDone }: { open: boolean; onClose: () => void; order: Order; onDone: () => void }) {
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = orderProgress(order);
  const n = Number(qty);
  const check = n > 0 ? canDeliver(order, n) : null;
  const t = n > 0 ? lotTotals(n, order.unitPrice, order.tvaRate) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/marches-cadres/${order._id}/lots`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
        credentials: "include", body: JSON.stringify({ quantity: n, date, notes }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Livraison refusée");
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Livraison impossible"); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Livrer un lot" size="md">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="px-3 py-2 rounded-lg bg-neg-50 border border-neg/25 text-sm text-neg">{error}</p>}
        <p className="text-sm text-ink2">
          Reste à livrer : <strong className="num">{p.toDeliver} {order.unit}</strong> sur {order.totalQuantity}.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={`Quantité (${order.unit})`} required>
            <input type="number" min={1} max={p.toDeliver} className={inputCls} value={qty} required
              onChange={e => setQty(e.target.value)} />
          </FormField>
          <FormField label="Date" required>
            <input type="date" className={inputCls} value={date} required onChange={e => setDate(e.target.value)} />
          </FormField>
        </div>
        {check && !check.ok && <p className="text-xs text-warn">{check.message}</p>}
        {t && check?.ok && <p className="text-xs text-ink2">Ce lot représentera <strong className="num">{fullXof(t.ttc)}</strong> à facturer.</p>}
        <FormField label="Note"><input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} /></FormField>
        <div className="flex justify-end gap-3 pt-2 border-t border-line">
          <button type="button" onClick={onClose} className="px-4 h-10 rounded-lg border border-line2 text-sm text-ink2 hover:bg-surface2">Annuler</button>
          <button type="submit" disabled={saving || !!(check && !check.ok)} className="px-5 h-10 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50">
            {saving ? "Enregistrement…" : "Enregistrer la livraison"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
