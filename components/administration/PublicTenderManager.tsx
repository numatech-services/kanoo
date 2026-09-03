"use client";

import { useState } from "react";
import { toast } from "react-hot-toast";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/errors";

interface PublicTenderManagerProps {
  tender: any;
}

export function PublicTenderManager({ tender: initialTender }: PublicTenderManagerProps) {
  const router = useRouter();
  const [tender, setTender] = useState(initialTender);
  const [, setLoading] = useState(false);
  const [isAttributing, setIsAttributing] = useState(false);
  const [winnerData, setWinnerData] = useState({ winnerId: "", winnerAmount: 0 });

  // Fonction de mise à jour (PATCH)
  async function updateStatus(newStatus: string, extraData = {}) {
    setLoading(true);
    try {
      const res = await fetch(`/api/marches/${tender._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, ...extraData }),
      });

      if (!res.ok) throw new Error("Erreur lors de la mise à jour");

      const { data } = await res.json();
      setTender(data || tender);
      toast.success(`Statut mis à jour : ${newStatus}`);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Validation de l'attribution
  const handleAttribution = () => {
    if (!winnerData.winnerId || winnerData.winnerAmount <= 0) {
      return toast.error("Veuillez remplir les informations du gagnant");
    }
    updateStatus("attributed", {
      winnerId: winnerData.winnerId,
      winnerAmount: winnerData.winnerAmount,
      attributionDate: new Date()
    });
    setIsAttributing(false);
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Statut Principal */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-surface p-6 rounded-2xl border border-line shadow-sm gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">{tender.reference}</h1>
          <p className="text-sm text-ink3">{tender.object}</p>
        </div>
        
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
            tender.status === 'attributed' ? 'bg-pos-50 text-pos' : 'bg-info-50 text-info'
          }`}>
            {tender.status}
          </span>
          
          {tender.status === 'planning' && (
            <button 
              onClick={() => updateStatus('published')}
              className="bg-section text-white px-4 py-2 rounded-xl text-sm font-bold hover:brightness-95 transition"
            >
              Publier l'appel d'offres
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 2. Détails Techniques (Gauche) */}
        <div className="lg:col-span-2 bg-surface p-6 rounded-2xl border border-line">
          <h3 className="font-bold text-ink mb-4 border-b pb-2">Informations Générales</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-ink3">Montant estimé</p>
              <p className="font-bold text-lg">{tender.estimatedAmount?.toLocaleString()} XOF</p>
            </div>
            <div>
              <p className="text-ink3">Procédure</p>
              <p className="font-bold uppercase text-ink2">{tender.procedure?.replace(/_/g, ' ')}</p>
            </div>
            <div>
              <p className="text-ink3">Date de création</p>
              <p className="font-medium">{new Date(tender.createdAt).toLocaleDateString('fr-FR')}</p>
            </div>
            <div>
              <p className="text-ink3">ID Technique</p>
              <p className="text-[10px] font-mono text-ink3/50">{tender._id}</p>
            </div>
          </div>
        </div>

        {/* 3. Section Attribution (Droite) */}
        <div className="bg-surface2/20 p-6 rounded-2xl border border-line">
          <h3 className="font-bold text-ink mb-4">Adjudication</h3>
          
          {tender.status === 'attributed' ? (
            <div className="space-y-3 bg-pos-50 p-4 rounded-xl border border-pos/25">
              <div>
                <p className="text-[10px] text-pos font-bold uppercase">Titulaire</p>
                <p className="font-bold text-ink">{tender.winnerId}</p>
              </div>
              <div>
                <p className="text-[10px] text-pos font-bold uppercase">Montant Final</p>
                <p className="font-bold text-ink">{tender.winnerAmount?.toLocaleString()} XOF</p>
              </div>
            </div>
          ) : isAttributing ? (
            <div className="space-y-4 bg-surface p-4 rounded-xl shadow-inner border border-line">
              <div>
                <label className="text-[10px] font-bold text-ink3 uppercase">Nom de l'entreprise</label>
                <input 
                  type="text" 
                  className="w-full mt-1 p-2 bg-surface2 border-none rounded-lg text-sm"
                  onChange={(e) => setWinnerData({...winnerData, winnerId: e.target.value})}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-ink3 uppercase">Montant d'attribution</label>
                <input 
                  type="number" 
                  className="w-full mt-1 p-2 bg-surface2 border-none rounded-lg text-sm"
                  onChange={(e) => setWinnerData({...winnerData, winnerAmount: Number(e.target.value)})}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAttribution} className="flex-1 bg-section text-white py-2 rounded-lg text-xs font-bold">Confirmer</button>
                <button onClick={() => setIsAttributing(false)} className="flex-1 bg-surface2 text-ink3 py-2 rounded-lg text-xs">Annuler</button>
              </div>
            </div>
          ) : (
            <button 
              onClick={() => setIsAttributing(true)}
              disabled={tender.status === 'planning'}
              className={`w-full py-3 rounded-xl font-bold text-sm shadow-sm transition-all ${
                tender.status === 'planning' 
                ? 'bg-surface2 text-ink3 cursor-not-allowed' 
                : 'bg-ink text-white hover:bg-section'
              }`}
            >
              {tender.status === 'planning' ? "Publication requise" : "Attribuer le marché"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}