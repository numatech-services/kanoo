"use client";
import { useState, useEffect } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";

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
interface Product { _id: string; label: string; code: string; unitPrice: number; } // Pour le catalogue

interface CommandeFormProps { 
  initialData?: any; 
  onSave: (d: Record<string, unknown>) => Promise<void>; 
  onCancel: () => void; 
}

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
  const [mounted, setMounted] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]); // État pour le catalogue de produits
  
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [status, setStatus] = useState("draft");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<CmdLine[]>([calcLine({ description: "", quantity: 1, unitPrice: 0 })]);
  const [saving, setSaving] = useState(false);

  // Charger les fournisseurs ET le catalogue de produits
  useEffect(() => { 
    setMounted(true); 
    // Charger fournisseurs
    fetch("/api/suppliers?limit=100",{credentials:"include"})
      .then(r=>r.json()).then(d=>setSuppliers(d.data?.items||[])); 
    
    // Charger catalogue produits (pour lier au stock)
    fetch("/api/stock?limit=500",{credentials:"include"})
      .then(r=>r.json()).then(d=>setCatalog(d.data?.items||[]));
  }, []);

  useEffect(() => {
    if (initialData) {
      setSupplierId(typeof initialData.supplierId === 'object' ? initialData.supplierId._id : initialData.supplierId || "");
      setOrderDate(initialData.orderDate ? new Date(initialData.orderDate).toISOString().split('T')[0] : "");
      setExpectedDeliveryDate(initialData.expectedDeliveryDate ? new Date(initialData.expectedDeliveryDate).toISOString().split('T')[0] : "");
      setStatus(initialData.status || "draft");
      setNotes(initialData.notes || "");
      if (initialData.lines) setLines(initialData.lines);
    }
  }, [initialData]);

  if (!mounted) return null;

  function updateLine(i: number, f: keyof CmdLine, v: any) {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l;
      
      // Si on change le produit via le sélecteur
      if (f === "productId") {
        const prod = catalog.find(p => p._id === v);
        return calcLine({ 
          ...l, 
          productId: v, 
          description: prod?.label || l.description,
          unitPrice: prod?.unitPrice || l.unitPrice 
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
      await onSave({supplierId, orderDate, expectedDeliveryDate, status, lines, notes, totalHT, totalTVA, totalTTC});
      setSaving(false);
    }} className="space-y-5">
      
      <div className="grid grid-cols-4 gap-4">
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
        
        <FormField label="Statut">
          <select className={selectCls + " font-bold " + (status === 'received' ? 'text-green-600' : '')} 
                  value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="draft">Brouillon</option>
            <option value="confirmed">Confirmé</option>
            <option value="received">✅ Reçu (Impacte le stock)</option>
            <option value="cancelled">Annulé</option>
          </select>
        </FormField>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center border-b border-clay/10 pb-2">
          <p className="text-sm font-bold text-ink uppercase tracking-wider">Lignes de commande</p>
          <button type="button" onClick={()=>setLines(p=>[...p,calcLine({description:"",quantity:1,unitPrice:0})])} 
                  className="px-3 py-1 bg-cedar/10 text-cedar rounded-lg text-xs font-bold hover:bg-cedar hover:text-white transition-all">+ Ajouter</button>
        </div>

        {lines.map((l,i)=>(
          <div key={i} className="grid grid-cols-12 gap-2 bg-sand/30 p-3 rounded-xl items-center border border-clay/5">
            {/* SÉLECTEUR DE PRODUIT AU LIEU DU TEXTE */}
            <div className="col-span-5">
              <select 
                className={selectCls} 
                value={l.productId || ""} 
                onChange={e => updateLine(i, "productId", e.target.value)}
                required
              >
                <option value="">Sélectionner un produit...</option>
                {catalog.map(p => (
                  <option key={p._id} value={p._id}>{p.label} ({p.code})</option>
                ))}
              </select>
            </div>

            <input type="number" className={inputCls+" col-span-2"} value={l.quantity} onChange={e=>updateLine(i,"quantity",parseFloat(e.target.value)||0)} min={1} placeholder="Quantité" />
            <input type="number" className={inputCls+" col-span-2"} value={l.unitPrice} onChange={e=>updateLine(i,"unitPrice",parseFloat(e.target.value)||0)} min={0} placeholder="Prix" />
            
            <div className="col-span-2 text-right font-mono text-sm font-bold text-ink">
              {l.totalTTC.toLocaleString("fr-FR")}
            </div>
            
            <button type="button" onClick={()=>lines.length>1&&setLines(p=>p.filter((_,j)=>j!==i))} 
                    className="text-moss hover:text-red-500 font-bold text-center">×</button>
          </div>
        ))}
      </div>

      {/* Reste du formulaire (Notes et Totaux) inchangé mais gardé pour la cohérence */}
      <div className="flex justify-between items-start gap-6">
        <div className="flex-1">
          <label className="text-[10px] font-bold text-moss uppercase mb-1 block">Notes / Observations</label>
          <textarea className={inputCls+" resize-none"} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} />
        </div>
        <div className="w-72 space-y-1 text-sm bg-ink text-white rounded-2xl p-5 shadow-xl border border-white/5">
           <div className="flex justify-between opacity-60 text-xs"><span>Total HT</span><span>{totalHT.toLocaleString("fr-FR")} XOF</span></div>
           <div className="flex justify-between opacity-60 text-xs"><span>TVA (19%)</span><span>{totalTVA.toLocaleString("fr-FR")} XOF</span></div>
           <div className="flex justify-between font-bold border-t border-white/10 pt-3 mt-2 text-xl">
             <span className="text-sand">TOTAL TTC</span>
             <span className="text-white">{totalTTC.toLocaleString("fr-FR")}</span>
           </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-5">
        <button type="button" onClick={onCancel} className="px-6 py-2.5 text-sm font-bold text-moss hover:bg-sand rounded-xl">Annuler</button>
        <button type="submit" disabled={saving} className="px-10 py-2.5 bg-cedar text-white rounded-xl text-sm font-bold hover:bg-ink disabled:opacity-50 shadow-xl transition-transform active:scale-95">
          {saving ? "Envoi..." : "Enregistrer la commande"}
        </button>
      </div>
    </form>
  );
}