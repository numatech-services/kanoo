"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";

export const MOVEMENT_OPTIONS = [
  { value: "entry", label: "Entrée (achat, réception)" },
  { value: "exit", label: "Sortie (vente, consommation)" },
  { value: "return", label: "Retour (client ou interne)" },
  { value: "loss", label: "Perte / casse / vol" },
  { value: "adjustment", label: "Ajustement : stock réel constaté" },
] as const;

async function csrf() { return (await fetch("/api/auth/csrf").then(r => r.json())).csrfToken as string; }

/** Saisie d'un mouvement de stock sur un article. */
export function MovementDialog({ product, onClose, onDone }: {
  product: { _id: string; label: string; unit?: string; stockQty?: number; purchaseCost?: number };
  onClose: () => void; onDone: () => void;
}) {
  const [f, setF] = useState({ type: "entry", quantity: 1, unitCost: product.purchaseCost || 0, reason: "", reference: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isAdj = f.type === "adjustment";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.reason.trim()) { setError("Indiquez le motif."); return; }
    setSaving(true); setError("");
    const res = await fetch("/api/stock/movements", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({ productId: product._id, type: f.type, quantity: f.quantity, reason: f.reason, reference: f.reference || undefined, ...(f.type === "entry" ? { unitCost: f.unitCost } : {}) }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(d.error || "Mouvement refusé"); return; }
    onDone();
  }

  return (
    <Modal open onClose={onClose} title={`Mouvement — ${product.label}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink2">Stock actuel : <b className="text-ink">{product.stockQty ?? 0} {product.unit ?? ""}</b>{product.purchaseCost ? ` · coût moyen ${Number(product.purchaseCost).toLocaleString("fr-FR")} XOF` : ""}</p>
        {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
        <FormField label="Type">
          <select className={selectCls} value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}>
            {MOVEMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={isAdj ? "Stock réel compté" : "Quantité"} required>
            <input type="number" min={isAdj ? 0 : 0.01} step="any" className={inputCls} value={f.quantity} onChange={e => setF(p => ({ ...p, quantity: Number(e.target.value) }))} required />
          </FormField>
          {f.type === "entry" && (
            <FormField label="Coût d'achat unitaire" hint="Recalcule le coût moyen">
              <input type="number" min={0} className={inputCls} value={f.unitCost} onChange={e => setF(p => ({ ...p, unitCost: Number(e.target.value) }))} />
            </FormField>
          )}
        </div>
        <FormField label="Motif" required><input className={inputCls} value={f.reason} onChange={e => setF(p => ({ ...p, reason: e.target.value }))} placeholder="Ex. achat au comptant, consommation atelier…" required /></FormField>
        <FormField label="Référence du document"><input className={inputCls} value={f.reference} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} placeholder="N° de bon, de facture…" /></FormField>
        <button type="submit" disabled={saving} className="w-full h-10 rounded-lg bg-section text-white text-sm font-semibold disabled:opacity-60">{saving ? "Enregistrement…" : "Enregistrer le mouvement"}</button>
      </form>
    </Modal>
  );
}
