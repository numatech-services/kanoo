"use client";

import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";

interface IServiceProduct {
  _id: string;
  code: string;
  label: string;
  unitPrice: number;
  tvaRate: number;
  unit: string;
  isActive: boolean;
}

export default function ServicesPage() {
  const [services, setServices] = useState<IServiceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    code: "",
    label: "",
    unitPrice: 0,
    tvaRate: 0.18, // Taux standard souvent utilisé
    unit: "acte",
    description: ""
  });

  const loadServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/services");
      const data = await res.json();
      setServices(data.data || data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadServices(); }, [loadServices]);

  const columns: Column<IServiceProduct>[] = [
    { key: "code", label: "Code", className: "font-mono font-bold text-emerald-700" },
    { key: "label", label: "Libellé du Service" },
    { 
      key: "unitPrice", 
      label: "Prix Unitaire (HT)", 
      className: "text-right font-mono",
      render: (v) => Number(v).toLocaleString("fr-FR") + " XOF"
    },
    { 
      key: "tvaRate", 
      label: "TVA", 
      render: (v) => `${(Number(v) * 100).toFixed(0)}%` 
    },
    { key: "unit", label: "Unité", className: "italic text-moss" },
    { 
      key: "isActive", 
      label: "Statut",
      render: (v) => (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${v ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          {v ? "ACTIF" : "INACTIF"}
        </span>
      )
    },
  ];
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setSaving(true);

  // On prépare les données proprement
  const payload = {
    ...form,
    // On force la conversion en nombre au cas où
    unitPrice: Number(form.unitPrice),
    tvaRate: Number(String(form.tvaRate).replace(',', '.')), // Remplace la virgule par un point
    isService: true
  };

  try {
    const res = await fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (res.ok) {
      setModalOpen(false);
      setForm({ code: "", label: "", unitPrice: 0, tvaRate: 0.19, unit: "unité", description: "" });
      loadServices();
    } else {
      // Affiche l'erreur exacte du serveur (ex: code déjà existant)
      alert("Erreur : " + (result.error || "Impossible d'enregistrer"));
    }
  } catch (err) {
    alert("Erreur réseau");
  } finally {
    setSaving(false);
  }
}

  const inputClass = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500/20";
  const labelClass = "block text-[10px] font-bold text-moss uppercase mb-1";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Catalogue des Services</h1>
          <p className="text-sm text-emerald-700 italic font-medium">Gestion des prestations et tarifs de l'entité</p>
        </div>
        <button 
          onClick={() => setModalOpen(true)}
          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold shadow-lg hover:bg-emerald-700 transition-all active:scale-95"
        >
          + Nouveau Service
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-clay/10 shadow-sm overflow-hidden">
        <DataTable 
          columns={columns} 
          data={services} 
          loading={loading}
          keyExtractor={(row) => row._id}
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="CRÉER UN NOUVEAU SERVICE">
        <form onSubmit={handleSubmit} className="p-1 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Code Service *</label>
              <input 
                className={inputClass} placeholder="ex: ETAT-CIV-01" required
                value={form.code} onChange={e => setForm({...form, code: e.target.value})}
              />
            </div>
            <div>
              <label className={labelClass}>Libellé *</label>
              <input 
                className={inputClass} placeholder="ex: Acte de naissance" required
                value={form.label} onChange={e => setForm({...form, label: e.target.value})}
              />
            </div>
            <div>
              <label className={labelClass}>Prix Unitaire (HT) *</label>
              <input 
                type="number" className={inputClass} required
                value={form.unitPrice} onChange={e => setForm({...form, unitPrice: Number(e.target.value)})}
              />
            </div>
            <div>
              <label className={labelClass}>Taux TVA (ex: 0.18)</label>
              <input 
                type="number" step="0.01" className={inputClass}
                value={form.tvaRate} onChange={e => setForm({...form, tvaRate: Number(e.target.value)})}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setModalOpen(false)} className="text-sm font-medium text-moss">Annuler</button>
            <button 
              type="submit" disabled={saving}
              className="px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold disabled:opacity-50"
            >
              {saving ? "Enregistrement..." : "Enregistrer le Service"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}