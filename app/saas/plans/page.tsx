"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";

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

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Partial<Plan> | null>(null);
  
  // Empêche l'erreur d'hydratation (window is not defined)
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const loadPlans = async () => {
      try {
        const res = await fetch("/api/public/plans");
        const d = await res.json();
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
    const res = await fetch("/api/public/plans", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setIsEditOpen(false);
      // Rafraîchir la liste
      const r = await fetch("/api/public/plans");
      const d = await r.json();
      if (d.success) setPlans(d.data || []);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-ink uppercase italic tracking-tighter">
          Plans Tarifaires
        </h1>
        <button 
          onClick={() => openEdit()} 
          className="px-6 py-2 bg-cedar text-white rounded-xl font-bold shadow-lg hover:scale-105 transition-transform"
        >
          + Nouveau Plan
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-moss italic animate-pulse">
          Récupération des données numapilot...
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((p) => (
            <div 
              key={p.code} 
              className={`bg-white rounded-[2rem] border-2 p-6 flex flex-col justify-between transition-all ${
                p.highlighted ? "border-cedar shadow-xl scale-[1.02]" : "border-clay/10 shadow-sm"
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-[10px] font-black text-moss uppercase tracking-widest">{p.targetType}</span>
                    <h3 className="text-xl font-bold text-ink italic leading-none">{p.label}</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-cedar">{p.priceMonthly.toLocaleString()} <span className="text-xs">F</span></p>
                  </div>
                </div>
                
                <p className="text-[11px] font-bold text-moss mb-4 py-1 px-3 bg-sand/50 rounded-full w-fit">
                  👥 {p.maxUsers} utilisateurs max
                </p>

                <ul className="space-y-2 mb-6">
                  {p.features.map((f, i) => (
                    <li key={i} className="text-xs text-ink flex items-start gap-2 font-medium">
                      <span className="text-green-500 font-bold">✓</span> {f}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-2 border-t border-clay/5 pt-4">
                <button 
                  onClick={() => openEdit(p)} 
                  className="flex-1 py-2 border border-clay/20 rounded-xl text-xs font-bold text-moss hover:bg-sand"
                >
                  Modifier
                </button>
                <button 
                  className="flex-1 py-2 bg-ink text-white rounded-xl text-xs font-bold shadow-md hover:opacity-90"
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
              <label className="text-[10px] font-bold uppercase text-moss ml-1">Nom du plan</label>
              <input name="label" defaultValue={selectedPlan?.label} placeholder="Ex: Pro Plus" className="w-full p-3 border rounded-xl text-sm" required />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-moss ml-1">Code unique</label>
              <input name="code" defaultValue={selectedPlan?.code} placeholder="ex: pme_gold" className="w-full p-3 border rounded-xl text-sm" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-moss ml-1">Prix mensuel (XOF)</label>
              <input type="number" name="priceMonthly" defaultValue={selectedPlan?.priceMonthly} className="w-full p-3 border rounded-xl text-sm" required />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-moss ml-1">Nombre d'utilisateurs</label>
              <input type="number" name="maxUsers" defaultValue={selectedPlan?.maxUsers} className="w-full p-3 border rounded-xl text-sm" required />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-moss ml-1">Type de cible</label>
            <select name="targetType" defaultValue={selectedPlan?.targetType} className="w-full p-3 border rounded-xl text-sm bg-white">
              <option value="pme">PME / Entreprise</option>
              <option value="association">Association</option>
              <option value="administration">Administration</option>
              <option value="avocat">Cabinet d'Avocats</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-moss ml-1">Fonctionnalités (séparées par des virgules)</label>
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
              className="w-4 h-4 accent-cedar"
            />
            <label htmlFor="highlighted" className="text-sm font-bold text-ink">Mettre en avant ce plan</label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-clay/10">
            <button 
              type="button" 
              onClick={() => setIsEditOpen(false)} 
              className="px-4 py-2 text-sm font-bold text-moss"
            >
              Annuler
            </button>
            <button 
              type="submit" 
              className="px-8 py-2 bg-cedar text-white rounded-xl font-black shadow-lg hover:bg-ink transition-colors"
            >
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}