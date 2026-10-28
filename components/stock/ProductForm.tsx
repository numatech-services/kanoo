"use client";
import { useEffect, useState } from "react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { useWarehouses } from "@/components/stock/useWarehouses";
import { LotsEditor, lotsPayload, type LotRow } from "@/components/stock/LotsEditor";

import { buttonClass } from "@/components/ui/button-class";
export interface ProductFormValue {
  code: string; label: string; description: string; unit: string; category: string; barcode: string; location: string;
  unitPrice: number; tvaRate: number; stockMinAlert: number; stockMaxAlert: number; preferredSupplierId: string;
  isService: boolean; accountCode: string; trackingMode: string;
  initialQty: number; initialCost: number;
}

const EMPTY: ProductFormValue = {
  code: "", label: "", description: "", unit: "unité", category: "", barcode: "", location: "",
  unitPrice: 0, tvaRate: 0.19, stockMinAlert: 0, stockMaxAlert: 0, preferredSupplierId: "",
  isService: false, accountCode: "", trackingMode: "none", initialQty: 0, initialCost: 0,
};

/**
 * Fiche article (création et modification). À la création, le stock initial
 * part en mouvement d'entrée valorisé ; ensuite la quantité ne change que par
 * des mouvements — elle n'est pas modifiable ici.
 */
export function ProductForm({ initial, onSave, onCancel, creating }: {
  initial?: Partial<Omit<ProductFormValue, "preferredSupplierId">> & { preferredSupplierId?: unknown };
  onSave: (v: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  creating?: boolean;
}) {
  const [f, setF] = useState<ProductFormValue>(() => {
    const sup = initial?.preferredSupplierId as unknown;
    return {
      ...EMPTY, ...Object.fromEntries(Object.entries(initial ?? {}).filter(([, v]) => v !== undefined && v !== null)),
      preferredSupplierId: sup && typeof sup === "object" ? String((sup as { _id: string })._id) : sup ? String(sup) : "",
    } as ProductFormValue;
  });
  const [suppliers, setSuppliers] = useState<Array<{ _id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { warehouses } = useWarehouses();
  const [initialWarehouseId, setInitialWarehouseId] = useState("");
  const [initialLots, setInitialLots] = useState<LotRow[]>([{ lotNumber: "", expiryDate: "", qty: 0 }]);
  useEffect(() => {
    fetch("/api/suppliers?picker=1", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => d?.data?.items && setSuppliers(d.data.items)).catch(() => {});
  }, []);
  const u = <K extends keyof ProductFormValue>(k: K, v: ProductFormValue[K]) => setF(p => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.code.trim() || !f.label.trim()) { setError("Code et désignation obligatoires."); return; }
    setSaving(true); setError("");
    try {
      const { initialQty, initialCost, code, ...rest } = f;
      await onSave({
        ...rest, preferredSupplierId: f.preferredSupplierId || null,
        ...(creating ? {
          code: code.trim(), initialQty, initialCost, initialWarehouseId: initialWarehouseId || undefined,
          initialLots: f.trackingMode !== "none" && initialQty > 0 ? lotsPayload(initialLots) : undefined,
        } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="p-3 bg-neg-50 text-neg text-sm rounded-lg">{error}</p>}
      <div className="grid sm:grid-cols-3 gap-3">
        <FormField label="Code" required><input className={inputCls} value={f.code} disabled={!creating} onChange={e => u("code", e.target.value)} required /></FormField>
        <FormField label="Désignation" required className="sm:col-span-2"><input className={inputCls} value={f.label} onChange={e => u("label", e.target.value)} required /></FormField>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink2">
        <input type="checkbox" className="accent-section" checked={f.isService} onChange={e => u("isService", e.target.checked)} />
        Prestation / service (pas de stock)
      </label>
      <div className="grid sm:grid-cols-3 gap-3">
        <FormField label="Catégorie"><input className={inputCls} value={f.category} onChange={e => u("category", e.target.value)} placeholder="Informatique, mobilier…" /></FormField>
        <FormField label="Unité"><input className={inputCls} value={f.unit} onChange={e => u("unit", e.target.value)} /></FormField>
        <FormField label="Code-barres / réf. fabricant"><input className={inputCls} value={f.barcode} onChange={e => u("barcode", e.target.value)} /></FormField>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <FormField label="Prix de vente HT (FCFA)" required><input type="number" min={0} className={inputCls} value={f.unitPrice} onChange={e => u("unitPrice", Number(e.target.value))} /></FormField>
        <FormField label="TVA">
          <select className={selectCls} value={String(f.tvaRate)} onChange={e => u("tvaRate", Number(e.target.value))}>
            <option value="0.19">19 %</option><option value="0.1">10 %</option><option value="0.05">5 %</option><option value="0">Exonéré</option>
          </select>
        </FormField>
        <FormField label="Compte de vente" hint="Ex. 701100 marchandises, 706 services"><input className={inputCls} value={f.accountCode} onChange={e => u("accountCode", e.target.value)} /></FormField>
      </div>
      {!f.isService && (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            <FormField label="Emplacement"><input className={inputCls} value={f.location} onChange={e => u("location", e.target.value)} placeholder="Magasin A · rayon 2" /></FormField>
            <FormField label="Seuil d'alerte"><input type="number" min={0} className={inputCls} value={f.stockMinAlert} onChange={e => u("stockMinAlert", Number(e.target.value))} /></FormField>
            <FormField label="Stock maximal" hint="Sert à proposer la quantité à commander"><input type="number" min={0} className={inputCls} value={f.stockMaxAlert} onChange={e => u("stockMaxAlert", Number(e.target.value))} /></FormField>
          </div>
          <FormField label="Fournisseur habituel">
            <select className={selectCls} value={f.preferredSupplierId} onChange={e => u("preferredSupplierId", e.target.value)}>
              <option value="">—</option>
              {suppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </FormField>
          <FormField label="Suivi" hint="Lot : péremption et traçabilité ; série : chaque unité a son numéro">
            <select className={selectCls} value={f.trackingMode} onChange={e => u("trackingMode", e.target.value)}>
              <option value="none">Aucun (quantité seule)</option>
              <option value="lot">Par lot (péremption)</option>
              <option value="serial">Par numéro de série</option>
            </select>
          </FormField>
          {creating && (
            <div className="grid sm:grid-cols-3 gap-3 rounded-lg border border-line2 p-3">
              <FormField label="Entrepôt du stock initial">
                <select className={selectCls} value={initialWarehouseId} onChange={e => setInitialWarehouseId(e.target.value)}>
                  <option value="">Entrepôt par défaut</option>
                  {warehouses.filter(w => w.kind !== "comptoir").map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
                </select>
              </FormField>
              <FormField label="Stock initial" hint="Enregistré comme une entrée"><input type="number" min={0} className={inputCls} value={f.initialQty} onChange={e => u("initialQty", Number(e.target.value))} /></FormField>
              <FormField label="Coût d'achat unitaire (FCFA)" hint="Fixe le coût moyen (CMUP)"><input type="number" min={0} className={inputCls} value={f.initialCost} onChange={e => u("initialCost", Number(e.target.value))} /></FormField>
              {f.trackingMode !== "none" && f.initialQty > 0 && (
                <div className="sm:col-span-3">
                  <LotsEditor mode={f.trackingMode === "serial" ? "serial" : "lot"} quantity={f.initialQty} value={initialLots} onChange={setInitialLots} />
                </div>
              )}
            </div>
          )}
        </>
      )}
      <FormField label="Description"><textarea className={textareaCls} rows={2} value={f.description} onChange={e => u("description", e.target.value)} /></FormField>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className={buttonClass("secondary", "md")}>Annuler</button>
        <button type="submit" disabled={saving} className={buttonClass("primary", "md")}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
      </div>
    </form>
  );
}
