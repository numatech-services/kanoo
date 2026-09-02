"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { useRouter } from "next/navigation";
import { PackagePlus, AlertTriangle, TrendingUp, Boxes } from "lucide-react";

interface StockItem { 
  _id: string; 
  code: string; 
  label: string; 
  unit: string; 
  stockQty: number; 
  stockMinAlert: number; 
  unitPrice: number; 
  isAlert: boolean; 
  stockValue: number; 
}

export default function StockPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<StockItem[]>([]); 
  const [total, setTotal] = useState(0); 
  const [page, setPage] = useState(1); 
  const [loading, setLoading] = useState(true);
  const [alertOnly, setAlertOnly] = useState(false); 
  const [alertCount, setAlertCount] = useState(0); 
  const [totalValue, setTotalValue] = useState(0);
  
  const [mvtModal, setMvtModal] = useState<string | null>(null);
  const [mvtForm, setMvtForm] = useState({ type: "entry", quantity: 1, reason: "", unitCost: 0 });
  const [saving, setSaving] = useState(false); 
  const LIMIT = 30;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (alertOnly) params.set("alertOnly", "true");
      const res = await fetch(`/api/stock?${params}`, { credentials: "include" });
      const d = await res.json();
      setItems(d.data?.items || []);
      setTotal(d.data?.pagination?.total || 0);
      setAlertCount(d.data?.alertCount || 0);
      setTotalValue(d.data?.totalStockValue || 0);
    } catch (error) {
      console.error("Erreur chargement stock:", error);
    } finally {
      setLoading(false);
    }
  }, [page, alertOnly]);

  useEffect(() => { 
    setMounted(true); 
    load(); 
  }, [load]);

  async function handleMovement() {
    // FORCE ALERT POUR TEST
    alert("🚀 FONCTION APPELÉE ! ID Produit: " + mvtModal);
    
    if (!mvtForm.reason || mvtForm.reason.trim() === "") {
      alert("⚠️ MOTIF VIDE : Écrivez quelque chose dans le champ motif !");
      return;
    }

    setSaving(true);
    try {
      console.log("Envoi des données...", mvtForm);
      const res = await fetch("/api/stock/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: mvtModal, ...mvtForm })
      });

      const data = await res.json();

      if (res.ok) {
        alert("✅ SUCCÈS : Stock mis à jour !");
        setMvtModal(null);
        setMvtForm({ type: "entry", quantity: 1, reason: "", unitCost: 0 });
        load();
      } else {
        alert("❌ ERREUR API : " + (data.error || "Inconnu"));
      }
    } catch (err: any) {
      alert("🔥 ERREUR RÉSEAU : " + err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  const columns: Column<StockItem>[] = [
    { key: "code", label: "Code", className: "font-mono text-[10px] text-moss uppercase w-24" },
    { key: "label", label: "Produit / Article", className: "font-medium text-ink" },
    { key: "unit", label: "Unité", className: "text-moss text-xs" },
    { 
      key: "stockQty", 
      label: "En Stock", 
      className: "text-right font-mono font-bold", 
      render: (v, r) => (
        <span className={r.isAlert ? "text-red-600 bg-red-50 px-2 py-1 rounded-md" : "text-green-700"}>
          {Number(v).toLocaleString()}
        </span>
      ) 
    },
    { key: "stockMinAlert", label: "Alerte", className: "text-right font-mono text-moss text-xs", render: (v) => String(v) },
    { 
      key: "stockValue", 
      label: "Valeur (XOF)", 
      className: "text-right font-mono text-cedar font-semibold", 
      render: (v) => Math.round(Number(v)).toLocaleString("fr-FR") 
    },
    { 
      key: "isAlert", 
      label: "Statut", 
      render: (v) => v ? (
        <span className="flex items-center gap-1 text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter">
          <AlertTriangle size={10} /> Critique
        </span>
      ) : (
        <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter">OK</span>
      ) 
    },
    { 
      key: "_id", 
      label: "Action", 
      render: (v, r) => (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setMvtModal(String(v));
            setMvtForm({ type: "entry", quantity: 1, reason: "", unitCost: r.unitPrice });
          }} 
          className="px-3 py-1 text-xs bg-ink text-white rounded-lg hover:bg-cedar transition-colors shadow-sm"
        >
          Mouvement
        </button>
      ) 
    },
  ];

  const inp = "w-full px-3 py-2 bg-sand/20 border border-clay/20 rounded-xl text-sm focus:ring-2 focus:ring-cedar/30 outline-none transition-all";
  const lbl = "block text-[10px] font-bold text-moss uppercase mb-1 tracking-widest";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Gestion du stock</h1>
          <p className="text-sm text-moss italic">{total} référence{total > 1 ? "s" : ""} au catalogue</p>
        </div>
        <button onClick={() => router.push('/stock/new')} className="flex items-center gap-2 px-4 py-2 bg-cedar text-white rounded-xl text-sm font-bold hover:bg-ink transition-all shadow-md">
          <PackagePlus size={18} /> Nouveau Produit
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-clay/10 p-5 shadow-sm">
          <p className="text-[10px] font-bold text-moss uppercase">Valeur de l'inventaire</p>
          <p className="text-2xl font-bold font-mono text-ink mt-2">{Math.round(totalValue).toLocaleString("fr-FR")} <small className="text-xs font-normal opacity-50">XOF</small></p>
        </div>
        <div className={`rounded-2xl border p-5 shadow-sm ${alertCount > 0 ? "bg-red-50 border-red-100" : "bg-white border-clay/10"}`}>
          <p className="text-[10px] font-bold text-moss uppercase">Ruptures / Alertes</p>
          <p className={`text-2xl font-bold mt-2 ${alertCount > 0 ? "text-red-600" : "text-green-700"}`}>{alertCount}</p>
        </div>
        <div className="bg-white rounded-2xl border border-clay/10 p-5 shadow-sm">
          <p className="text-[10px] font-bold text-moss uppercase">Total Références</p>
          <p className="text-2xl font-bold mt-2 text-ink">{total}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-clay/10 shadow-sm overflow-hidden">
        <DataTable columns={columns} data={items} loading={loading} keyExtractor={s => s._id} />
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

     <Modal open={!!mvtModal} onClose={() => setMvtModal(null)} title="Mouvement de Stock">
        <div className="p-6 space-y-5 bg-white">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Opération</label>
              <select className={inp} value={mvtForm.type} onChange={e => setMvtForm(p => ({ ...p, type: e.target.value }))}>
                <option value="entry">📥 Entrée (Réception)</option>
                <option value="exit">📤 Sortie (Vente/Usage)</option>
                <option value="adjustment">🔄 Ajustement Inventaire</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Quantité</label>
              <input type="number" className={inp} value={mvtForm.quantity} onChange={e => setMvtForm(p => ({ ...p, quantity: Number(e.target.value) }))} min={1} />
            </div>
          </div>
          
          <div>
            <label className={lbl}>Motif ou Référence (OBLIGATOIRE)</label>
            <input className={inp} value={mvtForm.reason} onChange={e => setMvtForm(p => ({ ...p, reason: e.target.value }))} placeholder="Tapez la raison ici..." />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setMvtModal(null)} className="px-4 py-2 text-sm text-moss">Annuler</button>
            <button 
              onClick={() => {
                console.log("Clic détecté !");
                handleMovement();
              }} 
              className="px-6 py-2 bg-cedar text-white rounded-xl text-sm font-bold hover:bg-ink shadow-lg active:scale-95"
            >
              {saving ? "Enregistrement..." : "CONFIRMER MAINTENANT"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}