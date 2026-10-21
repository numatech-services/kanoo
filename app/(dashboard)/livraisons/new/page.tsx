"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Package, ArrowLeft, Save } from "lucide-react";
import { useWarehouses } from "@/components/stock/useWarehouses";

import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import {apiSend } from "@/lib/api-client";

// Ligne restant à livrer, reprise de la facture source
interface DeliveryLineDraft {
  description: string;
  quantity: number;
  unit: string;
  productId?: string;
  invoiceLineIndex: number;
}

export default function NewDeliveryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const { warehouses } = useWarehouses();
  
  // État du formulaire
  const [form, setForm] = useState({
    invoiceId: "",
    invoiceNumber: "",
    clientId: "",
    clientName: "",
    deliveryDate: new Date().toISOString().split('T')[0],
    deliveryAddress: "",
    number: "",
    lines: [] as DeliveryLineDraft[],
    notes: "",
    warehouseId: ""
  });

  // 1. Rechercher une facture par son numéro
  const searchInvoice = async (number: string) => {
    if (!number) return;
    setSearching(true);
    try {
      // Recherche dédiée aux livraisons : client et articles, sans montants.
      const res = await fetch(`/api/livraisons/source?number=${encodeURIComponent(number.trim())}`, { credentials: "include" });
      const d = await res.json();
      const src = d.data;

      if (res.ok && src) {
        setForm(prev => ({
          ...prev,
          invoiceId: src.invoiceId,
          invoiceNumber: src.number,
          clientId: src.client?._id,
          clientName: src.client?.name,
          deliveryAddress: src.client?.address || "",
          // Reste à livrer de chaque ligne de la facture (déjà livré déduit).
          lines: (src.lines || []).map((l: DeliveryLineDraft) => ({
            description: l.description,
            quantity: l.quantity,
            unit: l.unit || "unité",
            productId: l.productId,
            invoiceLineIndex: l.invoiceLineIndex,
          }))
        }));
        if (src.fullyDelivered) showToast("Cette facture est déjà entièrement livrée.", "info");
      } else {
        showToast(d.error || "Facture introuvable", "error");
      }
    } finally {
      setSearching(false);
    }
  };

  // 2. Enregistrer le BL
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.invoiceId) return showToast("Veuillez lier une facture", "warning");

    setLoading(true);
    try {
      const res = await apiSend("POST", "/api/livraisons", form);

      if (res.ok) {
        router.push("/livraisons");
        router.refresh();
      } else {
        const error = res.data;
        showToast("Erreur : " + error.error, "error");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <button onClick={() => router.back()} className="flex items-center text-ink2 hover:text-ink text-sm transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Retour
      </button>

      <div className="bg-surface rounded-2xl border border-line shadow-sm overflow-hidden">
        <div className="p-6 border-b border-line bg-surface2/5">
          <h1 className="page-title">Nouveau Bon de Livraison</h1>
          <p className="text-sm text-ink2">Créez un BL à partir d'une facture existante</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {/* Section Facture */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-ink2">Rechercher Facture (N°)</label>
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Ex: FAC-2024-001"
                  className="w-full pl-10 pr-4 py-2 bg-surface2/20 border border-line rounded-xl outline-none focus:ring-2 focus:ring-section/20"
                  onBlur={(e) => searchInvoice(e.target.value)}
                  disabled={searching}
                />
                <Search className={`absolute left-3 top-2.5 w-4 h-4 text-ink2 ${searching ? "animate-pulse" : ""}`} />
                {searching && (
                  <span className="absolute right-3 top-2.5 text-xs text-ink2">Recherche…</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-ink2">Entrepôt de départ</label>
              <select value={form.warehouseId} onChange={e => setForm({ ...form, warehouseId: e.target.value })}
                className="w-full px-4 py-2 bg-surface2/20 border border-line rounded-xl outline-none">
                <option value="">Entrepôt par défaut</option>
                {warehouses.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-ink2">Date de livraison</label>
              <input
                type="date"
                value={form.deliveryDate}
                onChange={e => setForm({...form, deliveryDate: e.target.value})}
                className="w-full px-4 py-2 bg-surface2/20 border border-line rounded-xl outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-ink2">Référence (laisser vide = automatique)</label>
              <input
                value={form.number}
                onChange={e => setForm({...form, number: e.target.value})}
                placeholder="BL-2026-… (auto si vide)"
                className="w-full px-4 py-2 bg-surface2/20 border border-line rounded-xl outline-none"
              />
            </div>
          </div>

          {/* Info Client (Lecture seule) */}
          {form.clientName && (
            <div className="p-4 bg-pos-50 border border-pos/25 rounded-xl">
              <p className="text-xs text-pos font-bold uppercase">Client lié</p>
              <p className="text-sm font-semibold text-pos">{form.clientName}</p>
              <p className="text-xs text-pos mt-1">{form.deliveryAddress}</p>
            </div>
          )}

          {/* Lignes du BL */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <Package className="w-4 h-4" /> Articles à livrer
            </h3>
            <div className="border border-line rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
              <table className="table-dense">
                <thead className="bg-surface2/30 text-ink2 text-[10px] uppercase font-bold">
                  <tr>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2 w-24">Volume</th>
                    <th className="px-4 py-2 w-24">Unité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {form.lines.length > 0 ? form.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-3">{line.description}</td>
                      <td className="px-4 py-3 font-mono">{line.quantity}</td>
                      <td className="px-4 py-3 text-ink2">{line.unit}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-ink2 italic">
                        Sélectionnez une facture pour charger les articles
                      </td>
                    </tr>
                  )}
                </tbody>
              </table></div>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={loading || !form.invoiceId}
              className={buttonClass("primary", "md")}
            >
              <Save className="w-4 h-4" />
              {loading ? "Création..." : "Générer le Bon de Livraison"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}