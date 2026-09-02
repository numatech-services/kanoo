"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Package, Calendar, ArrowLeft, Save } from "lucide-react";

export default function NewDeliveryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  
  // État du formulaire
  const [form, setForm] = useState({
    invoiceId: "",
    invoiceNumber: "",
    clientId: "",
    clientName: "",
    deliveryDate: new Date().toISOString().split('T')[0],
    deliveryAddress: "",
    lines: [] as any[],
    notes: ""
  });

  // 1. Rechercher une facture par son numéro
  const searchInvoice = async (number: string) => {
    if (!number) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/invoices?number=${number}`);
      const d = await res.json();
      const invoice = d.data?.items?.[0];

      if (invoice) {
        setForm(prev => ({
          ...prev,
          invoiceId: invoice._id,
          invoiceNumber: invoice.number,
          clientId: invoice.clientId?._id,
          clientName: invoice.clientId?.name,
          deliveryAddress: invoice.clientId?.address || "",
          lines: invoice.lines.map((l: any) => ({
            description: l.description,
            quantity: l.quantity,
            unit: l.unit || "unité",
            productId: l.productId
          }))
        }));
      } else {
        alert("Facture introuvable ou déjà traitée");
      }
    } finally {
      setSearching(false);
    }
  };

  // 2. Enregistrer le BL
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.invoiceId) return alert("Veuillez lier une facture");

    setLoading(true);
    try {
      const res = await fetch("/api/livraisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      if (res.ok) {
        router.push("/livraisons");
        router.refresh();
      } else {
        const error = await res.json();
        alert("Erreur : " + error.error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <button onClick={() => router.back()} className="flex items-center text-moss hover:text-ink text-sm transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Retour
      </button>

      <div className="bg-white rounded-2xl border border-clay/20 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-clay/10 bg-sand/5">
          <h1 className="text-xl font-bold text-ink">Nouveau Bon de Livraison</h1>
          <p className="text-sm text-moss">Créez un BL à partir d'une facture existante</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {/* Section Facture */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-moss">Rechercher Facture (N°)</label>
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Ex: FAC-2024-001"
                  className="w-full pl-10 pr-4 py-2 bg-sand/20 border border-clay/20 rounded-xl outline-none focus:ring-2 focus:ring-cedar/20"
                  onBlur={(e) => searchInvoice(e.target.value)}
                />
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-moss" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-moss">Date de livraison</label>
              <input 
                type="date" 
                value={form.deliveryDate}
                onChange={e => setForm({...form, deliveryDate: e.target.value})}
                className="w-full px-4 py-2 bg-sand/20 border border-clay/20 rounded-xl outline-none"
              />
            </div>
          </div>

          {/* Info Client (Lecture seule) */}
          {form.clientName && (
            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
              <p className="text-xs text-emerald-700 font-bold uppercase">Client lié</p>
              <p className="text-sm font-semibold text-emerald-900">{form.clientName}</p>
              <p className="text-xs text-emerald-600 mt-1">{form.deliveryAddress}</p>
            </div>
          )}

          {/* Lignes du BL */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <Package className="w-4 h-4" /> Articles à livrer
            </h3>
            <div className="border border-clay/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-sand/30 text-moss text-[10px] uppercase font-bold">
                  <tr>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2 w-24">Volume</th>
                    <th className="px-4 py-2 w-24">Unité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-clay/10">
                  {form.lines.length > 0 ? form.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-3">{line.description}</td>
                      <td className="px-4 py-3 font-mono">{line.quantity}</td>
                      <td className="px-4 py-3 text-moss">{line.unit}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-moss italic">
                        Sélectionnez une facture pour charger les articles
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={loading || !form.invoiceId}
              className="flex items-center gap-2 px-8 py-3 bg-cedar text-white rounded-xl font-bold hover:bg-ink disabled:opacity-50 transition-all shadow-lg"
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