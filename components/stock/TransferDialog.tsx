"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { useWarehouses } from "@/components/stock/useWarehouses";

import { buttonClass } from "@/components/ui/button-class";
import {apiJson, apiSend } from "@/lib/api-client";
interface Product { _id: string; code: string; label: string; unit?: string; trackingMode?: string }
interface Line { productId: string; quantity: number; lotNumber: string }
interface Lot { lotNumber: string; qty: number; expiryDate?: string; warehouseId?: { _id: string } | string }

/** Transfert d'articles d'un entrepôt à un autre (lots et péremptions suivent). */
export function TransferDialog({ onClose, onDone, product, fromWarehouseId }: {
  onClose: () => void; onDone: () => void; product?: Product; fromWarehouseId?: string;
}) {
  const { warehouses } = useWarehouses();
  const [from, setFrom] = useState(fromWarehouseId ?? "");
  const [to, setTo] = useState("");
  const [products, setProducts] = useState<Product[]>(product ? [product] : []);
  const [lines, setLines] = useState<Line[]>([{ productId: product?._id ?? "", quantity: 1, lotNumber: "" }]);
  const [lots, setLots] = useState<Record<string, Lot[]>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Entrepôt de départ par défaut dès que la liste arrive (ajusté pendant le rendu).
  if (!from && warehouses.length) setFrom((warehouses.find(w => w.isDefault) ?? warehouses[0])._id);
  useEffect(() => {
    if (product) return;
    apiJson("/api/products?isService=false&limit=100").then(d => setProducts(d.data?.items ?? [])).catch(() => {});
  }, [product]);
  useEffect(() => {
    for (const l of lines) {
      const p = products.find(x => x._id === l.productId);
      if (!p || !p.trackingMode || p.trackingMode === "none" || lots[p._id]) continue;
      apiJson(`/api/products/${p._id}/stock`).then(d => setLots(s => ({ ...s, [p._id]: d.data?.lots ?? [] }))).catch(() => {});
    }
  }, [lines, products, lots]);

  const setLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
  async function submit() {
    setError("");
    if (!from || !to || from === to) { setError("Choisissez deux entrepôts différents."); return; }
    const valid = lines.filter(l => l.productId && l.quantity > 0);
    if (!valid.length) { setError("Ajoutez au moins un article."); return; }
    setSaving(true);
    const res = await apiSend("POST", "/api/stock/transfers", { fromWarehouseId: from, toWarehouseId: to, reason, lines: valid.map(l => ({ productId: l.productId, quantity: l.quantity, lots: l.lotNumber ? [{ lotNumber: l.lotNumber, qty: l.quantity }] : undefined })) });
    const d = res.data;
    setSaving(false);
    if (!res.ok) { setError(d.error || "Transfert refusé"); return; }
    onDone();
  }

  return (
    <Modal open onClose={onClose} title="Transfert entre entrepôts" size="lg">
      <div className="space-y-4">
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Depuis" required>
            <select className={selectCls} value={from} onChange={e => setFrom(e.target.value)}>{warehouses.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}</select>
          </FormField>
          <FormField label="Vers" required>
            <select className={selectCls} value={to} onChange={e => setTo(e.target.value)}>
              <option value="">—</option>{warehouses.filter(w => w._id !== from).map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
            </select>
          </FormField>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => {
            const p = products.find(x => x._id === l.productId);
            const tracked = p?.trackingMode && p.trackingMode !== "none";
            const here = (lots[l.productId] ?? []).filter(x => (typeof x.warehouseId === "object" ? x.warehouseId?._id : x.warehouseId) === from);
            return (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <select className={`${selectCls} col-span-6`} value={l.productId} disabled={!!product} onChange={e => setLine(i, { productId: e.target.value, lotNumber: "" })} aria-label="Article">
                  <option value="">— Article —</option>{products.map(x => <option key={x._id} value={x._id}>{x.code} — {x.label}</option>)}
                </select>
                <input type="number" min={0.01} step="any" className={`${inputCls} col-span-2`} value={l.quantity} onChange={e => setLine(i, { quantity: Number(e.target.value) })} aria-label="Quantité" />
                {tracked ? (
                  <select className={`${selectCls} col-span-3`} value={l.lotNumber} onChange={e => setLine(i, { lotNumber: e.target.value })} aria-label="Lot">
                    <option value="">Lots FEFO</option>{here.map(x => <option key={x.lotNumber} value={x.lotNumber}>{x.lotNumber} ({x.qty}){x.expiryDate && new Date(x.expiryDate) < new Date(new Date().toDateString()) ? " — périmé" : ""}</option>)}
                  </select>
                ) : <span className="col-span-3 text-xs text-ink3">{p?.unit}</span>}
                {!product && lines.length > 1 && <button type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="col-span-1 text-ink3 hover:text-neg" aria-label="Retirer"><X size={14} /></button>}
              </div>
            );
          })}
          {!product && <button type="button" onClick={() => setLines(ls => [...ls, { productId: "", quantity: 1, lotNumber: "" }])} className="text-xs text-section font-semibold hover:underline">+ Ajouter un article</button>}
        </div>
        <FormField label="Motif"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="Réassort boutique, dotation véhicule…" /></FormField>
        <button onClick={submit} disabled={saving} className={buttonClass("primary", "md", "w-full")}>{saving ? "Transfert…" : "Transférer"}</button>
      </div>
    </Modal>
  );
}
