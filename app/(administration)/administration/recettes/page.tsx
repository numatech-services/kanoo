"use client";
import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";

interface Revenue {
  _id: string;
  reference: string;
  payerName: string;
  amount: number;
  type: string;
  paymentMethod: string;
  status: string;
  budgetChapterId: { code: string; label: string };
  createdAt: string;
}

export default function RecettesPage() {
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Formulaire initial
  const initialForm = {
    budgetChapterId: "",
    payerName: "",
    amount: 0,
    type: "service",
    paymentMethod: "cash",
    notes: ""
  };

  const [form, setForm] = useState(initialForm);

  // Chargement des données
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [revRes, chapRes] = await Promise.all([
        fetch("/api/recettes"),
        fetch("/api/budget?flat=true") 
      ]);
      
      const revData = await revRes.json();
      const chapData = await chapRes.json();

      setRevenues(Array.isArray(revData) ? revData : (revData.data || []));
      setChapters(Array.isArray(chapData) ? chapData : (chapData.data || []));
      
    } catch (err) {
      console.error("Erreur de chargement:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Calcul du total encaissé
  const totalCollecte = Array.isArray(revenues) 
    ? revenues.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) 
    : 0;

  // Soumission du formulaire
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    
    try {
      const res = await fetch("/api/recettes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      const result = await res.json();

      if (res.ok) {
        setModalOpen(false);
        setForm(initialForm);
        loadData();
      } else {
        alert("Erreur lors de l'ajout : " + (result.error || result.message));
      }
    } catch (err) {
      alert("Impossible de contacter le serveur.");
    } finally {
      setSaving(false);
    }
  }

  // Définition des colonnes
  const columns: Column<Revenue>[] = [
    { key: "reference", label: "Quittance", className: "font-mono font-bold text-emerald-700" },
    { key: "payerName", label: "Contribuable" },
    { 
      key: "budgetChapterId", 
      label: "Chapitre", 
      render: (v) => <span className="text-xs">{v?.code ? `${v.code} - ${v.label}` : 'N/A'}</span> 
    },
    { 
      key: "amount", 
      label: "Montant (XOF)", 
      className: "text-right font-mono font-bold",
      render: (v) => Number(v || 0).toLocaleString("fr-FR") 
    },
    { key: "paymentMethod", label: "Mode", className: "uppercase text-[10px] font-bold" },
    { key: "status", label: "Statut", render: (v) => <StatusBadge status={String(v)} /> },
  ];

  const inputClass = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none";
  const labelClass = "block text-[10px] font-bold text-moss uppercase mb-1";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Recettes & Taxes</h1>
          <p className="text-sm text-moss mt-0.5 font-medium italic text-emerald-700 tracking-wide">
            Trésorerie Public — Gestion des encaissements
          </p>
        </div>
        <button 
          onClick={() => setModalOpen(true)}
          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold shadow-lg hover:bg-emerald-700 transition-all active:scale-95"
        >
          + Nouvel Encaissement
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-clay/10 shadow-sm">
          <p className={labelClass}>Total Collecté</p>
          <p className="text-3xl font-black text-emerald-600">
            {totalCollecte.toLocaleString("fr-FR")} <span className="text-xs">XOF</span>
          </p>
        </div>
      </div>
{/* Tableau de données */}
<div className="bg-white rounded-2xl border border-clay/10 shadow-sm overflow-hidden">
  <DataTable 
    columns={columns} 
    data={Array.isArray(revenues) ? revenues : []} 
    loading={loading} 
    // AJOUTE CETTE LIGNE :
    keyExtractor={(item) => item._id || item.reference} 
  />
</div>

      {/* Modal d'encaissement */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="ENCAISSER UNE RECETTE" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4 p-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Ligne Budgétaire de Recette *</label>
              <select 
                className={inputClass} 
                value={form.budgetChapterId} 
                onChange={e => setForm({...form, budgetChapterId: e.target.value})} 
                required
              >
                <option value="">Sélectionner un chapitre...</option>
                {chapters
                  .filter(c => chapters.some(ch => ch.level === "ligne") ? c.level === "ligne" : true)
                  .map(c => (
                    <option key={c._id} value={c._id}>{c.code} - {c.label}</option>
                  ))
                }
              </select>
            </div>

            <div>
              <label className={labelClass}>Nom du Contribuable *</label>
              <input 
                type="text" className={inputClass} placeholder="Ex: M. Moussa Abdou"
                value={form.payerName} onChange={e => setForm({...form, payerName: e.target.value})} required 
              />
            </div>

            <div>
              <label className={labelClass}>Montant à percevoir (XOF) *</label>
              <input 
                type="number" className={`${inputClass} font-mono font-bold text-emerald-700 text-lg`}
                value={form.amount} onChange={e => setForm({...form, amount: Number(e.target.value)})} required 
              />
            </div>

            <div>
              <label className={labelClass}>Type de Recette</label>
              <select className={inputClass} value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                <option value="service">Service Municipal</option>
                <option value="taxe">Taxe / Impôt</option>
                <option value="droit_timbre">Droit de Timbre</option>
                <option value="location">Location</option>
                <option value="amende">Amende</option>
                <option value="autre">Autre</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Mode de Paiement</label>
              <select className={inputClass} value={form.paymentMethod} onChange={e => setForm({...form, paymentMethod: e.target.value as any})}>
                <option value="cash">Espèces (Cash)</option>
                <option value="orange_money">Orange Money</option>
                <option value="moov_money">Moov Money</option>
                <option value="transfer">Virement</option>
                <option value="cheque">Chèque</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-clay/10 mt-6">
            <button type="button" onClick={() => setModalOpen(false)} className="text-sm font-medium text-moss hover:underline">
              Annuler
            </button>
            <button 
              type="submit" 
              disabled={saving}
              className="px-8 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 shadow-md disabled:opacity-50 transition-colors"
            >
              {saving ? "Traitement..." : "Valider et Générer Quittance"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}