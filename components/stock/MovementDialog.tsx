"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { useWarehouses } from "@/components/stock/useWarehouses";
import { LotsEditor, lotsPayload, type LotRow } from "@/components/stock/LotsEditor";

import { buttonClass } from "@/components/ui/button-class";
import {apiJson, apiSend } from "@/lib/api-client";
export const MOVEMENT_OPTIONS = [
  { value: "entry", label: "Entrée (achat, réception)" },
  { value: "exit", label: "Sortie (vente, consommation)" },
  { value: "return", label: "Retour (client ou interne)" },
  { value: "loss", label: "Perte / casse / péremption" },
  { value: "adjustment", label: "Ajustement : stock réel constaté" },
] as const;

interface Lot { lotNumber: string; expiryDate?: string; qty: number; warehouseId?: { _id: string } | string }

/** Saisie d'un mouvement de stock : entrepôt, lots / numéros de série. */
export function MovementDialog({ product, onClose, onDone, defaultWarehouseId }: {
  product: { _id: string; label: string; unit?: string; stockQty?: number; purchaseCost?: number; trackingMode?: string };
  onClose: () => void; onDone: () => void; defaultWarehouseId?: string;
}) {
  const { warehouses } = useWarehouses();
  const tracked = product.trackingMode === "lot" || product.trackingMode === "serial";
  const serial = product.trackingMode === "serial";
  const [f, setF] = useState({ type: "entry", quantity: 1, unitCost: product.purchaseCost || 0, reason: "", reference: "", warehouseId: defaultWarehouseId ?? "" });
  const [lotsIn, setLotsIn] = useState<LotRow[]>([{ lotNumber: "", expiryDate: "", qty: 1 }]);
  const [lotOut, setLotOut] = useState("");
  const [avail, setAvail] = useState<Lot[]>([]);
  const [whQty, setWhQty] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isIn = f.type === "entry" || f.type === "return";
  const isAdj = f.type === "adjustment";

  // Entrepôt par défaut dès que la liste arrive (ajusté pendant le rendu).
  if (!f.warehouseId && warehouses.length) setF(p => ({ ...p, warehouseId: (warehouses.find(w => w.isDefault) ?? warehouses[0])._id }));
  useEffect(() => {
    apiJson(`/api/products/${product._id}/stock`).then(d => {
      setAvail(d.data?.lots ?? []);
      setWhQty(Object.fromEntries((d.data?.warehouses ?? []).map((w: { warehouseId: { _id: string }; qty: number }) => [w.warehouseId?._id, w.qty])));
    }).catch(() => {});
  }, [product._id]);
  const lotsHere = useMemo(() => avail.filter(l => (typeof l.warehouseId === "object" ? l.warehouseId?._id : l.warehouseId) === f.warehouseId), [avail, f.warehouseId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.reason.trim()) { setError("Indiquez le motif."); return; }
    let lots: Array<{ lotNumber: string; expiryDate?: string; qty: number }> | undefined;
    if (tracked) {
      if (isIn) {
        lots = lotsPayload(lotsIn);
        if (lots.reduce((s, l) => s + l.qty, 0) !== f.quantity) { setError("La somme des lots doit égaler la quantité."); return; }
      } else if (isAdj) {
        if (!lotOut) { setError("Choisissez le lot compté."); return; }
        lots = [{ lotNumber: lotOut, qty: f.quantity }];
      } else if (lotOut) lots = [{ lotNumber: lotOut, qty: f.quantity }];
    }
    setSaving(true); setError("");
    const res = await apiSend("POST", "/api/stock/movements", { productId: product._id, type: f.type, quantity: f.quantity, reason: f.reason, reference: f.reference || undefined, warehouseId: f.warehouseId || undefined, lots, ...(f.type === "entry" ? { unitCost: f.unitCost } : {}) });
    const d = res.data;
    setSaving(false);
    if (!res.ok) { setError(d.error || "Mouvement refusé"); return; }
    onDone();
  }

  return (
    <Modal open onClose={onClose} title={`Mouvement — ${product.label}`} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink2">Stock total : <b className="text-ink">{product.stockQty ?? 0} {product.unit ?? ""}</b>
          {f.warehouseId && whQty[f.warehouseId] !== undefined ? <> · dans cet entrepôt : <b className="text-ink">{whQty[f.warehouseId]}</b></> : null}
          {product.purchaseCost ? ` · coût moyen ${Number(product.purchaseCost).toLocaleString("fr-FR")} FCFA` : ""}
          {tracked ? ` · suivi par ${serial ? "numéro de série" : "lot"}` : ""}</p>
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <FormField label="Type">
            <select className={selectCls} value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}>
              {MOVEMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FormField>
          <FormField label="Entrepôt">
            <select className={selectCls} value={f.warehouseId} onChange={e => { setF(p => ({ ...p, warehouseId: e.target.value })); setLotOut(""); }}>
              {warehouses.map(w => <option key={w._id} value={w._id}>{w.name}{w.isDefault ? " (défaut)" : ""}</option>)}
            </select>
          </FormField>
          <FormField label={isAdj ? (tracked ? "Quantité comptée du lot" : "Stock réel compté") : "Quantité"} required>
            <input type="number" min={isAdj ? 0 : 0.01} step={serial ? 1 : "any"} className={inputCls} value={f.quantity} onChange={e => setF(p => ({ ...p, quantity: Number(e.target.value) }))} required />
          </FormField>
          {f.type === "entry" && (
            <FormField label="Coût d'achat unitaire" hint="Recalcule le coût moyen">
              <input type="number" min={0} className={inputCls} value={f.unitCost} onChange={e => setF(p => ({ ...p, unitCost: Number(e.target.value) }))} />
            </FormField>
          )}
        </div>
        {tracked && isIn && <LotsEditor mode={serial ? "serial" : "lot"} quantity={f.quantity} value={lotsIn} onChange={setLotsIn} />}
        {tracked && !isIn && (
          <FormField label={isAdj ? "Lot compté" : "Lot"} hint={isAdj ? undefined : "Laisser « automatique » : péremption la plus proche d'abord"}>
            <select className={selectCls} value={lotOut} onChange={e => setLotOut(e.target.value)}>
              {!isAdj && <option value="">Automatique (FEFO)</option>}
              {isAdj && <option value="">— Choisir —</option>}
              {lotsHere.map(l => <option key={l.lotNumber} value={l.lotNumber}>{l.lotNumber} · {l.qty} en stock{l.expiryDate ? (new Date(l.expiryDate) < new Date(new Date().toDateString()) ? " · PÉRIMÉ" : ` · périme le ${new Date(l.expiryDate).toLocaleDateString("fr-FR")}`) : ""}</option>)}
            </select>
          </FormField>
        )}
        <FormField label="Motif" required><input className={inputCls} value={f.reason} onChange={e => setF(p => ({ ...p, reason: e.target.value }))} placeholder="Ex. achat au comptant, consommation atelier…" required /></FormField>
        <FormField label="Référence du document"><input className={inputCls} value={f.reference} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} placeholder="N° de bon, de facture…" /></FormField>
        <button type="submit" disabled={saving} className={buttonClass("primary", "md", "w-full")}>{saving ? "Enregistrement…" : "Enregistrer le mouvement"}</button>
      </form>
    </Modal>
  );
}
