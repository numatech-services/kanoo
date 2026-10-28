"use client";
import { useState, useEffect, useSyncExternalStore } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { ImputationFields, type ImputationValue } from "@/components/shared/ImputationFields";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson } from "@/lib/api-client";
// On ajoute productId dans l'interface pour faire le lien avec le stock
interface CmdLine { 
  productId?: string; // CRUCIAL pour le stock
  description: string; 
  quantity: number; 
  unitPrice: number; 
  tvaRate: number; 
  totalHT: number; 
  totalTVA: number; 
  totalTTC: number; 
}

interface Supplier { _id: string; name: string; code: string; }
interface Product { _id: string; label: string; code: string; unitPrice: number; purchaseCost?: number; lastPurchaseCost?: number; }

// Bon de commande existant à modifier (références peuplées ou simples identifiants)
interface CommandeInitialData {
  supplierId?: { _id: string } | string | null;
  orderDate?: string;
  expectedDeliveryDate?: string;
  notes?: string;
  projectId?: unknown;
  activityId?: unknown;
  costCenter?: string;
  lines?: Array<Partial<Omit<CmdLine, "productId">> & { productId?: unknown }>;
}

interface CommandeFormProps { 
  initialData?: CommandeInitialData; 
  onSave: (d: Record<string, unknown>) => Promise<void>; 
  onCancel: () => void; 
}

// Faux au rendu serveur et pendant l'hydratation (rien n'est affiché), vrai ensuite.
const noSubscribe = () => () => {};

function calcLine(l: Partial<CmdLine>): CmdLine {
  const qty = l.quantity || 0; 
  const price = l.unitPrice || 0; 
  const tva = l.tvaRate ?? TVA_TAUX_STANDARD;
  const ht = Math.round(qty * price); 
  const tvaAmt = calculerTVA(ht, tva);
  return { 
    productId: l.productId,
    description: l.description || "", 
    quantity: qty, 
    unitPrice: price, 
    tvaRate: tva, 
    totalHT: ht, 
    totalTVA: tvaAmt, 
    totalTTC: ht + tvaAmt 
  };
}

export function CommandeForm({ initialData, onSave, onCancel }: CommandeFormProps) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]); // État pour le catalogue de produits
  
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [imputation, setImputation] = useState<ImputationValue>({});
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<CmdLine[]>([calcLine({ description: "", quantity: 1, unitPrice: 0 })]);
  const [saving, setSaving] = useState(false);

  // Charger les fournisseurs ET le catalogue de produits
  useEffect(() => { 
    // Charger fournisseurs
    apiJson("/api/suppliers?picker=1").then(d=>setSuppliers(d.data?.items||[])); 
    
    // Charger catalogue produits (pour lier au stock)
    apiJson("/api/stock?limit=100").then(d=>setCatalog(d.data?.items||[]));
  }, []);

  // Bon existant : le formulaire en reprend les valeurs dès le rendu où il
  // arrive (motif « ajuster l'état pendant le rendu »).
  const [appliedData, setAppliedData] = useState<CommandeInitialData | undefined>(undefined);
  if (initialData !== appliedData) {
    setAppliedData(initialData);
    if (initialData) {
      // Fournisseur peuplé, identifiant brut ou absent (null) : `typeof null` vaut « object ».
      const sup = initialData.supplierId;
      setSupplierId(sup && typeof sup === "object" ? sup._id : sup || "");
      setOrderDate(initialData.orderDate ? new Date(initialData.orderDate).toISOString().split('T')[0] : "");
      setExpectedDeliveryDate(initialData.expectedDeliveryDate ? new Date(initialData.expectedDeliveryDate).toISOString().split('T')[0] : "");
      setNotes(initialData.notes || "");
      const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id: string })._id) : v ? String(v) : undefined);
      setImputation({ projectId: idOf(initialData.projectId), activityId: idOf(initialData.activityId), costCenter: initialData.costCenter });
      if (initialData.lines) setLines(initialData.lines.map((l) => ({ ...l, productId: idOf(l.productId) }) as CmdLine));
    }
  }

  if (!mounted) return null;

  function updateLine<K extends keyof CmdLine>(i: number, f: K, v: CmdLine[K]) {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l;
      
      // Si on change le produit via le sélecteur
      if (f === "productId") {
        const productId = v as CmdLine["productId"];
        const prod = catalog.find(p => p._id === productId);
        return calcLine({ 
          ...l, 
          productId, 
          description: prod?.label || l.description,
          // Prix d'achat : dernier coût connu, sinon CMUP ; jamais le prix de vente.
          unitPrice: prod?.lastPurchaseCost || prod?.purchaseCost || l.unitPrice
        });
      }
      
      return calcLine({ ...l, [f]: v });
    }));
  }

  const totalHT = lines.reduce((s, l) => s + l.totalHT, 0);
  const totalTVA = lines.reduce((s, l) => s + l.totalTVA, 0);
  const totalTTC = totalHT + totalTVA;

  return (
    <form onSubmit={async(e)=>{
      e.preventDefault();
      setSaving(true);
      await onSave({supplierId, orderDate, expectedDeliveryDate, notes, ...imputation,
        projectId: imputation.projectId ?? null, activityId: imputation.activityId ?? null, costCenter: imputation.costCenter ?? null,
        lines: lines.map(l => ({ productId: l.productId || undefined, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, tvaRate: l.tvaRate })) });
      setSaving(false);
    }} className="space-y-5">
      
      <div className="grid sm:grid-cols-3 gap-4">
        <FormField label="Fournisseur" required>
          <select className={selectCls} value={supplierId} onChange={e=>setSupplierId(e.target.value)} required>
            <option value="">Choisir…</option>
            {suppliers.map(s=><option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </FormField>
        <FormField label="Date commande" required>
          <input type="date" className={inputCls} value={orderDate} onChange={e=>setOrderDate(e.target.value)} required />
        </FormField>
        <FormField label="Livraison prévue">
          <input type="date" className={inputCls} value={expectedDeliveryDate} onChange={e=>setExpectedDeliveryDate(e.target.value)} />
        </FormField>
        
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center border-b border-line pb-2">
          <p className="text-sm font-bold text-ink uppercase tracking-wider">Lignes de commande</p>
          <button type="button" onClick={()=>setLines(p=>[...p,calcLine({description:"",quantity:1,unitPrice:0})])} 
                  className="px-3 py-1 bg-section/10 text-section rounded-lg text-xs font-bold hover:bg-section hover:text-white transition-all">+ Ajouter</button>
        </div>

        {lines.map((l,i)=>(
          <div key={i} className="grid grid-cols-12 gap-2 bg-surface2/30 p-3 rounded-xl items-center border border-line">
            {/* SÉLECTEUR DE PRODUIT AU LIEU DU TEXTE */}
            <div className="col-span-5 space-y-1">
              <select 
                className={selectCls} 
                value={l.productId || ""} 
                onChange={e => updateLine(i, "productId", e.target.value)}
                aria-label="Article du stock"
              >
                <option value="">Hors stock (prestation, frais…)</option>
                {catalog.map(p => (
                  <option key={p._id} value={p._id}>{p.label} ({p.code})</option>
                ))}
              </select>
              {!l.productId && (
                <input className={inputCls} placeholder="Désignation" value={l.description} onChange={e => updateLine(i, "description", e.target.value)} required />
              )}
            </div>

            <input type="number" className={inputCls+" col-span-2"} value={l.quantity} onChange={e=>updateLine(i,"quantity",parseFloat(e.target.value)||0)} min={1} placeholder="Quantité" />
            <input type="number" className={inputCls+" col-span-2"} value={l.unitPrice} onChange={e=>updateLine(i,"unitPrice",parseFloat(e.target.value)||0)} min={0} placeholder="Prix" />
            
            <div className="col-span-2 text-right font-mono text-sm font-bold text-ink">
              {l.totalTTC.toLocaleString("fr-FR")}
            </div>
            
            <button type="button" onClick={()=>lines.length>1&&setLines(p=>p.filter((_,j)=>j!==i))} 
                    className="text-ink2 hover:text-neg font-bold text-center">×</button>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <p className="text-sm font-bold text-ink uppercase tracking-wider">Imputation</p>
        <ImputationFields value={imputation} onChange={setImputation} />
      </div>

      <div className="flex justify-between items-start gap-6">
        <div className="flex-1">
          <label className="text-[10px] font-bold text-ink2 uppercase mb-1 block">Notes / Observations</label>
          <textarea className={inputCls+" resize-none"} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} />
        </div>
        <div className="w-72 space-y-1 text-sm bg-ink text-onink rounded-2xl p-5 shadow-xl border border-white/5">
           <div className="flex justify-between opacity-60 text-xs"><span>Total HT</span><span>{totalHT.toLocaleString("fr-FR")} FCFA</span></div>
           <div className="flex justify-between opacity-60 text-xs"><span>TVA (19%)</span><span>{totalTVA.toLocaleString("fr-FR")} FCFA</span></div>
           <div className="flex justify-between font-bold border-t border-white/10 pt-3 mt-2 text-xl">
             <span className="text-white">TOTAL TTC</span>
             <span className="text-white">{totalTTC.toLocaleString("fr-FR")}</span>
           </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-5">
        <button type="button" onClick={onCancel} className="px-6 py-2.5 text-sm font-bold text-ink2 hover:bg-surface2 rounded-xl">Annuler</button>
        <button type="submit" disabled={saving} className={buttonClass("primary", "md")}>
          {saving ? "Envoi..." : "Enregistrer la commande"}
        </button>
      </div>
    </form>
  );
}