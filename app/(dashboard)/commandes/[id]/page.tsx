"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Printer, Edit3, ArrowLeft, CheckCircle2, PackageCheck, Ban, Trash2, FileText } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { CommandeForm } from "@/components/pme/CommandeForm";
import { useMe, meCanDo } from "@/lib/useMe";
import { useWarehouses } from "@/components/stock/useWarehouses";
import { LotsEditor, lotsPayload, type LotRow } from "@/components/stock/LotsEditor";

import { confirmDialog } from "@/components/ui/Dialogs";
import { buttonClass } from "@/components/ui/button-class";
interface Line {
  productId?: { _id: string; code: string; label: string; unit?: string; trackingMode?: string } | string;
  description: string; quantity: number; unitPrice: number; totalHT: number; receivedQty?: number;
}
interface Commande {
  _id: string; number: string; status: string; orderDate: string; expectedDeliveryDate?: string; notes?: string;
  supplierId?: { _id: string; name: string; code?: string } | null;
  projectId?: { code: string; name: string } | null; activityId?: { name: string } | null; costCenter?: string;
  lines: Line[]; totalHT: number; totalTVA: number; totalTTC: number; purchaseId?: string;
}

const fmt = (n: unknown) => Number(n || 0).toLocaleString("fr-FR");
async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }
async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Action impossible");
  return d.data;
}

export default function CommandeDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const me = useMe();
  const canEdit = meCanDo(me, "commandes", "update");
  const canDelete = meCanDo(me, "commandes", "delete");
  const canPurchase = meCanDo(me, "purchases", "create");
  const [item, setItem] = useState<Commande | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const d = await fetch(`/api/commandes/${id}`, { credentials: "include" }).then(r => r.json()).catch(() => null);
    setItem(d?.data ?? null);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Action impossible"); }
  }

  if (loading) return <div className="p-6"><div className="h-48 bg-surface rounded-xl animate-pulse border border-line" /></div>;
  if (!item) return <div className="p-6 text-neg">Commande introuvable.</div>;

  const editable = ["draft", "confirmed"].includes(item.status);
  const anyReceived = item.lines.some(l => (l.receivedQty ?? 0) > 0);
  const receivable = ["confirmed", "partially_received"].includes(item.status);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <div>
          <Link href="/commandes" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Bons de commande</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="page-title">BC {item.number}</h1>
            <StatusBadge status={item.status} />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => window.print()} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm hover:bg-surface2"><Printer size={16} /> Imprimer</button>
          {canEdit && item.status === "draft" && (
            <button onClick={() => act(() => send(`/api/commandes/${id}`, "PATCH", { status: "confirmed" }))} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm font-semibold hover:bg-surface2"><CheckCircle2 size={16} /> Confirmer</button>
          )}
          {canEdit && receivable && (
            <button onClick={() => setReceiveOpen(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold hover:brightness-95"><PackageCheck size={16} /> Réceptionner</button>
          )}
          {canPurchase && ["confirmed", "partially_received", "received"].includes(item.status) && !item.purchaseId && (
            <Link href={`/depenses/nouvelle?commandeId=${item._id}`} className={buttonClass("secondary", "md")}><FileText size={16} /> Saisir la facture fournisseur</Link>
          )}
          {item.purchaseId && <Link href={`/depenses/${item.purchaseId}`} className={buttonClass("secondary", "md")}><FileText size={16} /> Facture fournisseur</Link>}
          {canEdit && editable && (
            <button onClick={() => setEditOpen(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm hover:bg-surface2"><Edit3 size={16} /> Modifier</button>
          )}
          {canEdit && editable && !anyReceived && (
            <button onClick={async () => { if (await confirmDialog({ title: "Annuler cette commande ?", danger: true })) act(() => send(`/api/commandes/${id}`, "PATCH", { status: "cancelled" })); }} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-warn/30 text-warn text-sm hover:bg-warn-50"><Ban size={16} /> Annuler</button>
          )}
          {canDelete && item.status === "draft" && (
            <button onClick={async () => { if (!(await confirmDialog({ title: "Supprimer ce brouillon ?", danger: true }))) return; try { await send(`/api/commandes/${id}`, "DELETE"); router.push("/commandes"); } catch (e) { setError(e instanceof Error ? e.message : "Suppression impossible"); } }}
              className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50"><Trash2 size={16} /> Supprimer</button>
          )}
        </div>
      </div>
      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-surface rounded-2xl border border-line p-5">
          <h3 className="text-sm font-bold text-ink2 uppercase mb-3">Articles</h3>
          <table className="table-dense w-full">
            <thead><tr className="text-left text-ink2 border-b border-line">
              <th>Désignation</th><th className="text-center">Commandé</th><th className="text-center">Reçu</th><th className="text-right">P.U. HT</th><th className="text-right">Total HT</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {item.lines.map((l, i) => {
                const p = typeof l.productId === "object" ? l.productId : null;
                const rec = l.receivedQty ?? 0;
                return (
                  <tr key={i}>
                    <td className="py-2.5"><span className="font-medium text-ink">{l.description}</span>{p && <span className="block text-[11px] text-ink3">Stock · {p.code}</span>}</td>
                    <td className="text-center">{l.quantity}</td>
                    <td className={`text-center ${rec >= l.quantity ? "text-pos font-semibold" : rec > 0 ? "text-warn" : "text-ink3"}`}>{rec}</td>
                    <td className="text-right font-mono text-xs">{fmt(l.unitPrice)}</td>
                    <td className="text-right font-mono font-semibold">{fmt(l.totalHT)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="space-y-4">
          <div className="bg-surface rounded-2xl border border-line p-5 text-sm space-y-1">
            <p className="text-[10px] font-bold text-ink2 uppercase">Fournisseur</p>
            <p className="font-bold text-ink">{item.supplierId?.name || "—"}</p>
            <p className="text-ink2">Commande du {new Date(item.orderDate).toLocaleDateString("fr-FR")}</p>
            {item.expectedDeliveryDate && <p className="text-ink2">Livraison prévue le {new Date(item.expectedDeliveryDate).toLocaleDateString("fr-FR")}</p>}
            {(item.projectId || item.activityId) && (
              <p className="text-ink2 pt-2">Imputation : {[item.projectId && `${item.projectId.code} ${item.projectId.name}`, item.activityId?.name].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <div className="bg-surface rounded-2xl border border-line p-5 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-ink2">Total HT</span><span className="font-mono">{fmt(item.totalHT)}</span></div>
            <div className="flex justify-between"><span className="text-ink2">TVA</span><span className="font-mono">{fmt(item.totalTVA)}</span></div>
            <div className="flex justify-between font-bold text-lg pt-2 border-t border-line"><span>Total TTC</span><span className="font-mono">{fmt(item.totalTTC)} FCFA</span></div>
          </div>
          {item.notes && <p className="text-xs text-ink2 whitespace-pre-wrap">{item.notes}</p>}
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Modifier le BC ${item.number}`} size="xl">
        <CommandeForm initialData={item} onSave={async body => { await send(`/api/commandes/${id}`, "PATCH", body); setEditOpen(false); load(); }} onCancel={() => setEditOpen(false)} />
      </Modal>
      {receiveOpen && <ReceiveDialog cmd={item} onClose={() => setReceiveOpen(false)} onDone={() => { setReceiveOpen(false); load(); }} />}
    </div>
  );
}

function ReceiveDialog({ cmd, onClose, onDone }: { cmd: Commande; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<number[]>(cmd.lines.map(l => Math.max(0, l.quantity - (l.receivedQty ?? 0))));
  const { warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [lots, setLots] = useState<LotRow[][]>(cmd.lines.map(l => [{ lotNumber: "", expiryDate: "", qty: Math.max(0, l.quantity - (l.receivedQty ?? 0)) }]));
  const modeOf = (l: Line) => (typeof l.productId === "object" && l.productId?.trackingMode && l.productId.trackingMode !== "none" ? l.productId.trackingMode : null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true); setError("");
    try {
      await send(`/api/commandes/${cmd._id}/receive`, "POST", {
        warehouseId: warehouseId || undefined,
        lines: qty.map((quantity, index) => ({ index, quantity, ...(modeOf(cmd.lines[index]) ? { lots: lotsPayload(lots[index]) } : {}) })).filter(x => x.quantity > 0),
      });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Réception impossible"); setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Réception — BC ${cmd.number}`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-ink2">Saisissez les quantités effectivement livrées. Les articles du stock y entrent au prix d&apos;achat de la commande (coût moyen recalculé).</p>
        <label className="block"><span className="block text-xs font-medium text-ink2 mb-1">Entrepôt de réception</span>
          <select className="w-full h-10 px-3 rounded-lg border border-line2 bg-surface text-sm" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
            <option value="">Entrepôt par défaut</option>
            {warehouses.filter(w => w.kind !== "comptoir").map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
          </select>
        </label>
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <table className="table-dense w-full">
          <thead><tr className="text-left text-ink2"><th>Article</th><th className="text-center">Reste</th><th className="text-right">Reçu maintenant</th></tr></thead>
          <tbody>
            {cmd.lines.map((l, i) => {
              const rest = Math.max(0, l.quantity - (l.receivedQty ?? 0));
              const mode = modeOf(l);
              return (
                <tr key={i} className="border-t border-line align-top">
                  <td className="py-2">{l.description}{!l.productId && <span className="block text-[11px] text-ink3">hors stock</span>}
                    {mode && qty[i] > 0 && <div className="mt-2"><LotsEditor mode={mode as "lot" | "serial"} quantity={qty[i]} value={lots[i]} onChange={v => setLots(ls => ls.map((x, j) => j === i ? v : x))} /></div>}
                  </td>
                  <td className="text-center">{rest}</td>
                  <td className="text-right">
                    <input type="number" min={0} max={rest} className="w-24 px-2 py-1 border border-line rounded-lg text-sm text-right" value={qty[i]} disabled={rest === 0}
                      onChange={e => setQty(q => q.map((x, j) => j === i ? Math.min(rest, Math.max(0, Number(e.target.value))) : x))} aria-label={`Quantité reçue — ${l.description}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button onClick={submit} disabled={saving} className={buttonClass("primary", "md", "w-full")}>{saving ? "Enregistrement…" : "Valider la réception"}</button>
      </div>
    </Modal>
  );
}
