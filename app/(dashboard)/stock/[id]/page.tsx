"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Edit3, ArrowLeftRight, Undo2, Archive, Download, Truck } from "lucide-react";
import { TransferDialog } from "@/components/stock/TransferDialog";
import { useWarehouses } from "@/components/stock/useWarehouses";
import { Modal } from "@/components/ui/Modal";
import { selectCls, inputCls } from "@/components/ui/FormField";
import { ProductForm } from "@/components/stock/ProductForm";
import { MovementDialog, MOVEMENT_OPTIONS } from "@/components/stock/MovementDialog";
import { useMe, meCanDo } from "@/lib/useMe";

import { confirmDialog, promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
interface Product {
  _id: string; code: string; label: string; description?: string; unit?: string; category?: string; barcode?: string; location?: string;
  unitPrice: number; tvaRate: number; stockQty: number; stockMinAlert: number; stockMaxAlert?: number; purchaseCost?: number; lastPurchaseCost?: number;
  preferredSupplierId?: { _id: string; name: string } | null; isService: boolean; isActive: boolean; accountCode?: string; trackingMode?: string;
}
interface Movement {
  _id: string; type: string; quantity: number; quantityBefore: number; quantityAfter: number; unitCost?: number; avgCostAfter?: number;
  reason: string; linkedDocNumber?: string; createdAt: string; reversedBy?: string; reverses?: string;
  warehouseId?: { code: string; name: string } | null; lots?: Array<{ lotNumber: string; qty: number }>;
  createdBy?: { firstName?: string; lastName?: string } | null;
}
const fmt = (n: unknown) => Number(n || 0).toLocaleString("fr-FR");
const TYPE_LABEL: Record<string, string> = { entry: "Entrée", exit: "Sortie", return: "Retour", loss: "Perte", adjustment: "Ajustement", transfer: "Transfert" };
interface ByWarehouse { _id: string; qty: number; minAlert?: number; warehouseId?: { _id: string; code: string; name: string; kind: string } | null }
interface LotRowView { _id: string; lotNumber: string; qty: number; expiryDate?: string; unitCost?: number; warehouseId?: { name: string } | null }
async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }

export default function StockDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const me = useMe();
  const canEdit = meCanDo(me, "products", "update");
  const canDelete = meCanDo(me, "products", "delete");
  const [p, setP] = useState<Product | null>(null);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [filter, setFilter] = useState({ type: "", from: "", to: "" });
  const [editOpen, setEditOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [byWh, setByWh] = useState<ByWarehouse[]>([]);
  const { warehouses } = useWarehouses();
  const [lots, setLots] = useState<LotRowView[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ productId: String(id), limit: "100" });
    if (filter.type) params.set("type", filter.type);
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    const [a, b] = await Promise.all([
      fetch(`/api/products/${id}`, { credentials: "include" }).then(r => r.json()).catch(() => null),
      fetch(`/api/stock/movements?${params}`, { credentials: "include" }).then(r => r.json()).catch(() => null),
    ]);
    setP(a?.data ?? null);
    setMoves(b?.data?.items ?? []);
    const st = await fetch(`/api/products/${id}/stock`, { credentials: "include" }).then(r => r.json()).catch(() => null);
    setByWh(st?.data?.warehouses ?? []);
    setLots(st?.data?.lots ?? []);
  }, [id, filter]);
  useEffect(() => { load(); }, [load]);

  // Entrepôts actifs (même vides, pour y fixer un seuil) + ceux où il reste du stock.
  const whRows = [
    ...warehouses.filter(w => w.isActive !== false).map(w => {
      const r = byWh.find(x => x.warehouseId?._id === w._id);
      return { id: w._id, name: w.name, kind: w.kind, qty: r?.qty ?? 0, minAlert: r?.minAlert };
    }),
    ...byWh.filter(r => r.qty !== 0 && r.warehouseId && !warehouses.some(w => w._id === r.warehouseId!._id && w.isActive !== false))
      .map(r => ({ id: r.warehouseId!._id, name: r.warehouseId!.name, kind: r.warehouseId!.kind, qty: r.qty, minAlert: r.minAlert })),
  ];
  async function saveThreshold(warehouseId: string, v: string) {
    const res = await fetch(`/api/products/${id}/stock`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, body: JSON.stringify({ warehouseId, minAlert: v === "" ? null : Number(v) }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.error || "Seuil refusé", "error"); }
    load();
  }

  async function reverse(m: Movement) {
    const reason = await promptDialog({ title: "Motif de l'annulation (un contre-mouvement sera enregistré) :", multiline: true });
    if (reason === null) return;
    setError("");
    const res = await fetch(`/api/stock/movements/${m._id}?reason=${encodeURIComponent(reason)}`, { method: "DELETE", credentials: "include", headers: { "x-csrf-token": await csrf() } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || "Annulation impossible"); return; }
    load();
  }
  async function saveProduct(body: Record<string, unknown>) {
    const res = await fetch(`/api/products/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Modification impossible");
    setEditOpen(false); load();
  }
  async function deactivate() {
    if (!(await confirmDialog({ title: "Désactiver cet article ?", message: "Il disparaît des listes ; son historique est conservé.", danger: true }))) return;
    const res = await fetch(`/api/products/${id}`, { method: "DELETE", credentials: "include", headers: { "x-csrf-token": await csrf() } });
    if (res.ok) router.push("/stock"); else setError("Désactivation impossible");
  }

  if (!p) return <div className="p-6"><div className="h-48 bg-surface rounded-xl animate-pulse border border-line" /></div>;
  const csvParams = new URLSearchParams({ productId: String(id), format: "csv", ...(filter.type ? { type: filter.type } : {}), ...(filter.from ? { from: filter.from } : {}), ...(filter.to ? { to: filter.to } : {}) });

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/stock" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Stock</Link>
          <h1 className="page-title mt-1">{p.label}</h1>
          <p className="text-sm text-ink2 font-mono">{p.code}{p.barcode ? ` · ${p.barcode}` : ""}{!p.isActive ? " · désactivé" : ""}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canEdit && !p.isService && byWh.length > 0 && <button onClick={() => setTransfer(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm hover:bg-surface2"><Truck size={16} /> Transfert</button>}
          {canEdit && !p.isService && <button onClick={() => setMoving(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg bg-section text-white text-sm font-semibold"><ArrowLeftRight size={16} /> Mouvement</button>}
          {canEdit && <button onClick={() => setEditOpen(true)} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-line2 text-sm hover:bg-surface2"><Edit3 size={16} /> Modifier</button>}
          {canDelete && p.isActive && <button onClick={deactivate} className="px-4 h-10 inline-flex items-center gap-2 rounded-lg border border-neg/25 text-neg text-sm hover:bg-neg-50"><Archive size={16} /> Désactiver</button>}
        </div>
      </div>
      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      <div className="grid sm:grid-cols-4 gap-4">
        {[
          ["En stock", `${fmt(p.stockQty)} ${p.unit ?? ""}`, p.stockMinAlert > 0 && p.stockQty <= p.stockMinAlert ? "text-neg" : "text-ink"],
          ["Coût moyen (CMUP)", p.purchaseCost ? `${fmt(p.purchaseCost)} FCFA` : "à valoriser", p.purchaseCost ? "text-ink" : "text-warn"],
          ["Valeur au coût", `${fmt(p.stockQty * (p.purchaseCost || 0))} FCFA`, "text-ink"],
          ["Prix de vente HT", `${fmt(p.unitPrice)} FCFA`, "text-ink"],
        ].map(([k, v, c]) => (
          <div key={k} className="bg-surface rounded-xl border border-line p-4"><p className="text-[11px] font-semibold text-ink2 uppercase">{k}</p><p className={`text-lg font-bold mt-1 ${c}`}>{v}</p></div>
        ))}
      </div>
      <div className="bg-surface rounded-xl border border-line p-4 grid sm:grid-cols-3 gap-2 text-sm">
        <p><span className="text-ink3">Catégorie :</span> {p.category || "—"}</p>
        <p><span className="text-ink3">Emplacement :</span> {p.location || "—"}</p>
        <p><span className="text-ink3">Fournisseur habituel :</span> {p.preferredSupplierId?.name || "—"}</p>
        <p><span className="text-ink3">Seuil d&apos;alerte :</span> {fmt(p.stockMinAlert)}</p>
        <p><span className="text-ink3">Stock maximal :</span> {fmt(p.stockMaxAlert)}</p>
        <p><span className="text-ink3">Dernier prix d&apos;achat :</span> {p.lastPurchaseCost ? `${fmt(p.lastPurchaseCost)} FCFA` : "—"}</p>
      </div>

      {!p.isService && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-surface rounded-xl border border-line p-4">
            <h2 className="font-semibold text-ink mb-2">Stock par entrepôt</h2>
            {whRows.length === 0 ? <p className="text-sm text-ink3">Aucun stock.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-ink3 uppercase"><th className="text-left font-semibold py-1">Entrepôt</th><th className="text-right font-semibold">Quantité</th><th className="text-right font-semibold">Seuil propre</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {whRows.map(w => {
                    const low = w.minAlert != null && w.minAlert > 0 && w.qty <= w.minAlert;
                    return (
                      <tr key={w.id}>
                        <td className="py-1.5">{w.name}{w.kind === "comptoir" ? " (comptoir)" : ""}</td>
                        <td className={`text-right font-mono font-semibold ${low ? "text-neg" : ""}`}>{fmt(w.qty)} {p.unit}</td>
                        <td className="text-right">
                          {canEdit
                            ? <input type="number" min={0} defaultValue={w.minAlert ?? ""} placeholder="—" aria-label={`Seuil — ${w.name}`}
                                className="w-20 h-7 px-2 rounded border border-line2 bg-surface text-right font-mono text-xs"
                                onBlur={e => { const v = e.target.value; if (v !== String(w.minAlert ?? "")) saveThreshold(w.id, v); }} />
                            : <span className="font-mono text-ink2">{w.minAlert ?? "—"}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {canEdit && whRows.length > 0 && <p className="text-[11px] text-ink3 mt-2">Seuil propre : alerte quand le stock de cet entrepôt passe dessous (vide = aucun).</p>}
          </div>
          {p.trackingMode && p.trackingMode !== "none" && (
            <div className="bg-surface rounded-xl border border-line p-4">
              <h2 className="font-semibold text-ink mb-2">{p.trackingMode === "serial" ? "Numéros de série en stock" : "Lots en stock"} ({lots.length})</h2>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {lots.map(l => {
                      const exp = l.expiryDate ? new Date(l.expiryDate) : null;
                      const days = exp ? Math.round((exp.getTime() - Date.now()) / 86400000) : null;
                      return (
                        <tr key={l._id} className="border-t border-line">
                          <td className="py-1 font-mono">{l.lotNumber}</td><td>{l.warehouseId?.name}</td>
                          <td className="text-right font-mono">{fmt(l.qty)}</td>
                          <td className={`text-right ${days !== null && days < 0 ? "text-neg font-semibold" : days !== null && days <= 30 ? "text-warn" : "text-ink2"}`}>{exp ? exp.toLocaleDateString("fr-FR") : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="p-4 flex items-center justify-between gap-2 flex-wrap border-b border-line">
          <h2 className="font-semibold text-ink">Historique des mouvements</h2>
          <div className="flex gap-2 flex-wrap items-center">
            <select className={`${selectCls} w-auto h-9 text-sm`} value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))} aria-label="Type">
              <option value="">Tous types</option>{MOVEMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{TYPE_LABEL[o.value]}</option>)}
            </select>
            <input type="date" className={`${inputCls} w-auto h-9 text-sm`} value={filter.from} onChange={e => setFilter(f => ({ ...f, from: e.target.value }))} aria-label="Du" />
            <input type="date" className={`${inputCls} w-auto h-9 text-sm`} value={filter.to} onChange={e => setFilter(f => ({ ...f, to: e.target.value }))} aria-label="Au" />
            <a href={`/api/stock/movements?${csvParams}`} className={buttonClass("secondary", "md")}><Download size={14} /> CSV</a>
          </div>
        </div>
        <table className="table-dense w-full">
          <thead><tr className="bg-surface2/50 text-left"><th>Date</th><th>Type</th><th>Entrepôt</th><th className="text-right">Qté</th><th className="text-right">Avant → Après</th><th className="text-right">Coût unit.</th><th>Motif</th><th>Par</th><th /></tr></thead>
          <tbody>
            {moves.length === 0 && <tr><td colSpan={9} className="text-center text-ink3 py-6">Aucun mouvement</td></tr>}
            {moves.map(m => (
              <tr key={m._id} className={`border-t border-line ${m.reversedBy ? "opacity-50 line-through" : ""}`}>
                <td className="text-xs text-ink2 whitespace-nowrap">{new Date(m.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>{TYPE_LABEL[m.type] ?? m.type}{m.reverses ? " (annulation)" : ""}</td>
                <td className="text-xs">{m.warehouseId?.name ?? "—"}</td>
                <td className={`text-right font-mono font-semibold ${m.quantity > 0 ? "text-pos" : m.quantity < 0 ? "text-neg" : ""}`}>{m.quantity > 0 ? "+" : ""}{fmt(m.quantity)}</td>
                <td className="text-right font-mono text-xs text-ink2">{fmt(m.quantityBefore)} → {fmt(m.quantityAfter)}</td>
                <td className="text-right font-mono text-xs">{m.unitCost ? fmt(m.unitCost) : "—"}</td>
                <td className="text-xs">{m.reason}{m.linkedDocNumber && <span className="text-section"> · {m.linkedDocNumber}</span>}
                  {m.lots && m.lots.length > 0 && <span className="block text-ink3 font-mono">{m.lots.map(l => `${l.lotNumber}:${l.qty > 0 ? "+" : ""}${l.qty}`).join(" ")}</span>}</td>
                <td className="text-xs text-ink2">{m.createdBy ? `${m.createdBy.firstName ?? ""} ${m.createdBy.lastName ?? ""}` : "—"}</td>
                <td className="text-right">{canDelete && !m.reversedBy && !m.reverses && m.quantity !== 0 && (
                  <button onClick={() => reverse(m)} title="Annuler par un contre-mouvement" className="p-1 rounded text-ink3 hover:text-neg"><Undo2 size={14} /></button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Modifier — ${p.label}`} size="lg">
        <ProductForm initial={{ ...p, trackingMode: p.trackingMode ?? "none", description: p.description ?? "", category: p.category ?? "", barcode: p.barcode ?? "", location: p.location ?? "", accountCode: p.accountCode ?? "" }} onSave={saveProduct} onCancel={() => setEditOpen(false)} />
      </Modal>
      {moving && <MovementDialog product={p} onClose={() => setMoving(false)} onDone={() => { setMoving(false); load(); }} />}
      {transfer && <TransferDialog product={{ _id: p._id, code: p.code, label: p.label, unit: p.unit, trackingMode: p.trackingMode }} onClose={() => setTransfer(false)} onDone={() => { setTransfer(false); load(); }} />}
    </div>
  );
}
