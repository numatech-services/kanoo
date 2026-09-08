"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { useRouter } from "next/navigation";
import { PackagePlus, AlertTriangle } from "lucide-react";
import { errorMessage } from "@/lib/errors";

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
    if (!mvtForm.reason || mvtForm.reason.trim() === "") {
      alert("Indiquez un motif pour ce mouvement.");
      return;
    }

    setSaving(true);
    try {
      const { csrfToken } = await fetch("/api/auth/csrf").then((r) => r.json());
      const res = await fetch("/api/stock/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ productId: mvtModal, ...mvtForm }),
      });
      const data = await res.json();
      if (res.ok) {
        setMvtModal(null);
        setMvtForm({ type: "entry", quantity: 1, reason: "", unitCost: 0 });
        load();
      } else {
        alert(data.error || "Le mouvement de stock a échoué.");
      }
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  const columns: Column<StockItem>[] = [
    { key: "code", label: "Code", className: "font-mono text-[10px] text-ink2 uppercase w-24" },
    { key: "label", label: "Produit / Article", className: "font-medium text-ink" },
    { key: "unit", label: "Unité", className: "text-ink2 text-xs" },
    { 
      key: "stockQty", 
      label: "En Stock", 
      className: "text-right font-mono font-bold", 
      render: (v, r) => (
        <span className={r.isAlert ? "text-neg bg-neg-50 px-2 py-1 rounded-md" : "text-pos"}>
          {Number(v).toLocaleString()}
        </span>
      ) 
    },
    { key: "stockMinAlert", label: "Alerte", className: "text-right font-mono text-ink2 text-xs", render: (v) => String(v) },
    { 
      key: "stockValue", 
      label: "Valeur (XOF)", 
      className: "text-right font-mono text-section font-semibold", 
      render: (v) => Math.round(Number(v)).toLocaleString("fr-FR") 
    },
    { 
      key: "isAlert", 
      label: "Statut", 
      render: (v) => v ? (
        <span className="flex items-center gap-1 text-[10px] bg-neg-50 text-neg px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter">
          <AlertTriangle size={10} /> Critique
        </span>
      ) : (
        <span className="text-[10px] bg-pos-50 text-pos px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter">OK</span>
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
          className="px-3 py-1 text-xs bg-ink text-white rounded-lg hover:bg-section transition-colors shadow-sm"
        >
          Mouvement
        </button>
      ) 
    },
  ];

  const inp = "w-full px-3 py-2 bg-surface2/20 border border-line rounded-xl text-sm focus:ring-2 focus:ring-section/30 outline-none transition-all";
  const lbl = "block text-[10px] font-bold text-ink2 uppercase mb-1 tracking-widest";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Gestion du stock</h1>
          <p className="text-sm text-ink2 italic">{total} référence{total > 1 ? "s" : ""} au catalogue</p>
        </div>
        <button onClick={() => router.push('/stock/new')} className="flex items-center gap-2 px-4 py-2 bg-section text-white rounded-xl text-sm font-bold hover:brightness-95 transition-all shadow-md">
          <PackagePlus size={18} /> Nouveau Produit
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface rounded-2xl border border-line p-5 shadow-sm">
          <p className="text-[10px] font-bold text-ink2 uppercase">Valeur de l'inventaire</p>
          <p className="text-2xl font-bold font-mono text-ink mt-2">{Math.round(totalValue).toLocaleString("fr-FR")} <small className="text-xs font-normal opacity-50">XOF</small></p>
        </div>
        {/* Le filtre `alertOnly` était bien envoyé à l'API mais aucun contrôle
            ne pouvait l'activer : il valait faux pour toujours. La carte le
            pilote désormais. */}
        <button
          type="button"
          onClick={() => { setAlertOnly(v => !v); setPage(1); }}
          aria-pressed={alertOnly}
          className={`text-left rounded-2xl border p-5 shadow-sm transition-colors ${
            alertOnly ? "bg-neg-50 border-neg/25 ring-2 ring-red-200"
                      : alertCount > 0 ? "bg-neg-50 border-neg/25 hover:bg-neg-50"
                                       : "bg-surface border-line hover:bg-surface2/40"
          }`}
        >
          <p className="text-[10px] font-bold text-ink2 uppercase">Ruptures / Alertes</p>
          <p className={`text-2xl font-bold mt-2 ${alertCount > 0 ? "text-neg" : "text-pos"}`}>{alertCount}</p>
          <p className="text-[10px] text-ink2 mt-1">
            {alertOnly ? "Filtre actif — cliquez pour tout afficher" : "Cliquez pour ne voir que les alertes"}
          </p>
        </button>
        <div className="bg-surface rounded-2xl border border-line p-5 shadow-sm">
          <p className="text-[10px] font-bold text-ink2 uppercase">Total Références</p>
          <p className="text-2xl font-bold mt-2 text-ink">{total}</p>
        </div>
      </div>

      <div className="bg-surface rounded-2xl border border-line shadow-sm overflow-hidden">
        <DataTable columns={columns} data={items} loading={loading} keyExtractor={s => s._id} />
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} total={total} limit={LIMIT} onPage={setPage} />

     <Modal open={!!mvtModal} onClose={() => setMvtModal(null)} title="Mouvement de Stock">
        <div className="p-6 space-y-5 bg-surface">
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
            <button onClick={() => setMvtModal(null)} className="px-4 py-2 text-sm text-ink2">Annuler</button>
            <button 
              onClick={() => {
                console.log("Clic détecté !");
                handleMovement();
              }} 
              className="px-6 py-2 bg-section text-white rounded-xl text-sm font-bold hover:brightness-95 shadow-lg active:scale-95"
            >
              {saving ? "Enregistrement..." : "CONFIRMER MAINTENANT"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}