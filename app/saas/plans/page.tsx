"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { Modal } from "@/components/ui/Modal";

import { buttonClass } from "@/components/ui/button-class";
import { apiJson, apiSend } from "@/lib/api-client";
import { showToast } from "@/components/ui/Toast";
interface Plan {
  _id?: string;
  code: string;
  label: string;
  targetType: string;
  priceMonthly: number;
  maxUsers: number;
  features: string[];
  highlighted: boolean;
}

// Rendu côté navigateur uniquement : faux au rendu serveur (et à l'hydratation), vrai ensuite.
const noSubscribe = () => () => {};

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Partial<Plan> | null>(null);
  
  // Empêche l'erreur d'hydratation (window is not defined)
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);

  useEffect(() => {
    const loadPlans = async () => {
      try {
        const d = await apiJson("/api/public/plans");
        if (d.success) setPlans(d.data || []);
      } catch (err) {
        console.error("Erreur chargement:", err);
      } finally {
        setLoading(false);
      }
    };
    loadPlans();
  }, []);

  // Rendu de sécurité pour synchroniser Serveur et Client
  if (!mounted) return null;

  const openEdit = (plan: Plan | null = null) => {
    setSelectedPlan(plan || { 
      label: "", 
      code: "", 
      priceMonthly: 0, 
      maxUsers: 1, 
      features: [], 
      targetType: "pme", 
      highlighted: false 
    });
    setIsEditOpen(true);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      ...selectedPlan,
      label: formData.get("label"),
      code: formData.get("code"),
      priceMonthly: Number(formData.get("priceMonthly")),
      maxUsers: Number(formData.get("maxUsers")),
      targetType: formData.get("targetType"),
      highlighted: formData.get("highlighted") === "on",
      features: (formData.get("features") as string)
        .split(",")
        .map(f => f.trim())
        .filter(f => f !== "")
    };

    const method = data._id ? "PATCH" : "POST";
    const res = await apiSend(method, "/api/superadmin/plans", data);

    if (!res.ok) { showToast(res.data?.error || "Enregistrement impossible", "error"); return; }
    {
      setIsEditOpen(false);
      // Rafraîchir la liste
      const d = await apiJson("/api/public/plans");
      if (d.success) setPlans(d.data || []);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">
          Plans Tarifaires
        </h1>
        <button 
          onClick={() => openEdit()} 
          className={buttonClass("primary", "md")}
        >
          + Nouveau Plan
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-ink2 italic animate-pulse">
          Récupération des données numapilot...
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((p) => (
            <div 
              key={p.code} 
              className={`bg-surface rounded-[2rem] border-2 p-6 flex flex-col justify-between transition-all ${
                p.highlighted ? "border-section shadow-xl scale-[1.02]" : "border-line shadow-sm"
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-[10px] font-black text-ink2 uppercase tracking-widest">{p.targetType}</span>
                    <h3 className="text-xl font-bold text-ink italic leading-none">{p.label}</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-section">{p.priceMonthly.toLocaleString("fr-FR")} <span className="text-xs">F</span></p>
                  </div>
                </div>
                
                <p className="text-[11px] font-bold text-ink2 mb-4 py-1 px-3 bg-surface2/50 rounded-full w-fit">
                  {p.maxUsers} utilisateurs max
                </p>

                <ul className="space-y-2 mb-6">
                  {p.features.map((f, i) => (
                    <li key={i} className="text-xs text-ink flex items-start gap-2 font-medium">
                      <span className="text-pos font-bold">✓</span> {f}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-2 border-t border-line pt-4">
                <button 
                  onClick={() => openEdit(p)} 
                  className="flex-1 py-2 border border-line rounded-xl text-xs font-bold text-ink2 hover:bg-surface2"
                >
                  Modifier
                </button>
                <button 
                  className="flex-1 py-2 bg-ink text-onink rounded-xl text-xs font-bold shadow-md hover:opacity-90"
                >
                  Assigner
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Utilisation explicite de la Modal pour corriger l'import */}
      <Modal 
        open={isEditOpen} 
        onClose={() => setIsEditOpen(false)} 
        title={selectedPlan?._id ? "Modifier le Plan" : "Créer un Plan"}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-ink2 ml-1">Nom du plan</label>
              <input name="label" defaultValue={selectedPlan?.label} placeholder="Ex: Pro Plus" className="w-full p-3 border rounded-xl text-sm" required />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-ink2 ml-1">Code unique</label>
              <input name="code" defaultValue={selectedPlan?.code} placeholder="ex: pme_gold" className="w-full p-3 border rounded-xl text-sm" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-ink2 ml-1">Prix mensuel (FCFA)</label>
              <input type="number" name="priceMonthly" defaultValue={selectedPlan?.priceMonthly} className="w-full p-3 border rounded-xl text-sm" required />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-ink2 ml-1">Nombre d'utilisateurs</label>
              <input type="number" name="maxUsers" defaultValue={selectedPlan?.maxUsers} className="w-full p-3 border rounded-xl text-sm" required />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink2 ml-1">Type de cible</label>
            <select name="targetType" defaultValue={selectedPlan?.targetType} className="w-full p-3 border rounded-xl text-sm bg-surface">
              <option value="pme">PME / Entreprise</option>
              <option value="association">Association</option>
              <option value="administration">Administration</option>
              <option value="avocat">Cabinet d'Avocats</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink2 ml-1">Fonctionnalités (séparées par des virgules)</label>
            <textarea 
              name="features" 
              placeholder="Support 24/7, Accès API, Stockage 10Go..." 
              defaultValue={selectedPlan?.features?.join(", ")} 
              className="w-full p-3 border rounded-xl text-sm" 
              rows={3} 
            />
          </div>

          <div className="flex items-center gap-2 py-2">
            <input 
              type="checkbox" 
              name="highlighted" 
              id="highlighted" 
              defaultChecked={selectedPlan?.highlighted} 
              className="w-4 h-4 accent-section"
            />
            <label htmlFor="highlighted" className="text-sm font-bold text-ink">Mettre en avant ce plan</label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-line">
            <button 
              type="button" 
              onClick={() => setIsEditOpen(false)} 
              className="px-4 py-2 text-sm font-bold text-ink2"
            >
              Annuler
            </button>
            <button 
              type="submit" 
              className={buttonClass("primary", "md")}
            >
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}