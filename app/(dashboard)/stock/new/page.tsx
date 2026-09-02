"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";
import { Package, ArrowLeft, Save } from "lucide-react";

export default function NewProductPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "",
    label: "",
    unit: "unité",
    stockMinAlert: 5,
    unitPrice: 0,
    category: "Général"
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken 
        },
        body: JSON.stringify({ ...form, stockQty: 0 }), // On initialise à 0 stock
      });

      if (res.ok) {
        router.push("/stock");
        router.refresh();
      } else {
        const d = await res.json();
        alert(d.error || "Erreur lors de la création");
      }
    } catch (err) {
      alert("Erreur de connexion");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button 
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-moss hover:text-ink transition-colors"
      >
        <ArrowLeft size={16} /> Retour au stock
      </button>

      <div className="bg-white rounded-3xl border border-clay/10 shadow-sm overflow-hidden">
        <div className="bg-sand/30 p-6 border-b border-clay/10">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white rounded-2xl shadow-sm text-cedar">
              <Package size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink">Nouveau produit</h1>
              <p className="text-xs text-moss">Enregistrez une nouvelle référence dans votre catalogue</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <FormField label="Code Article (SKU)" required>
              <input 
                className={inputCls} 
                value={form.code} 
                onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="Ex: LAIT-001"
                required 
              />
            </FormField>

            <FormField label="Unité de mesure" required>
              <select 
                className={selectCls} 
                value={form.unit} 
                onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
              >
                <option value="unité">Unité (pcs)</option>
                <option value="kg">Kilogramme (kg)</option>
                <option value="litre">Litre (L)</option>
                <option value="carton">Carton</option>
                <option value="sac">Sac</option>
              </select>
            </FormField>
          </div>

          <FormField label="Désignation du produit" required>
            <input 
              className={inputCls} 
              value={form.label} 
              onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
              placeholder="Ex: Lait Bonnet Rouge 400g"
              required 
            />
          </FormField>

          <div className="grid grid-cols-2 gap-6 pt-4 border-t border-clay/5">
            <FormField label="Prix d'achat unitaire (estimé)">
              <div className="relative">
                <input 
                  type="number" 
                  className={inputCls} 
                  value={form.unitPrice} 
                  onChange={e => setForm(p => ({ ...p, unitPrice: Number(e.target.value) }))}
                  min={0}
                />
                <span className="absolute right-3 top-2.5 text-xs text-moss font-bold">XOF</span>
              </div>
            </FormField>

            <FormField label="Seuil d'alerte stock">
              <input 
                type="number" 
                className={inputCls} 
                value={form.stockMinAlert} 
                onChange={e => setForm(p => ({ ...p, stockMinAlert: Number(e.target.value) }))}
                min={0}
              />
              <p className="text-[10px] text-ember mt-1 font-medium">Vous serez alerté si le stock tombe sous ce niveau.</p>
            </FormField>
          </div>

          <div className="flex justify-end gap-4 pt-6">
            <button 
              type="button"
              onClick={() => router.back()}
              className="px-6 py-2.5 text-sm font-bold text-moss hover:bg-sand rounded-xl transition-all"
            >
              Annuler
            </button>
            <button 
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-8 py-2.5 bg-cedar text-white rounded-xl text-sm font-bold hover:bg-ink disabled:opacity-50 shadow-lg transition-all"
            >
              <Save size={18} />
              {saving ? "Création..." : "Créer le produit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}