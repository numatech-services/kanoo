"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "react-hot-toast";

interface Tender {
  _id: string;
  reference: string;
  object: string;
  estimatedAmount: number;
  procedure: string;
  status: string;
  createdAt: string;
  winnerId?: string;
  winnerAmount?: number;
  bidsDeadline?: string;
}

export default function TenderDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  
  const [tender, setTender] = useState<Tender | null>(null);
  const [loading, setLoading] = useState(false);
  
  // États pour le formulaire d'attribution
  const [isAttributing, setIsAttributing] = useState(false);
  const [winnerData, setWinnerData] = useState({ winnerId: "", winnerAmount: 0 });

  // 1. Chargement des données au montage
  useEffect(() => {
    fetch(`/api/marches/${id}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setTender(d.data || d))
      .catch(() => toast.error("Erreur de chargement"));
  }, [id]);

  // 2. Fonction de mise à jour générique (PATCH)
  async function updateTender(updates: Partial<Tender>) {
    setLoading(true);
    try {
      const res = await fetch(`/api/marches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Erreur lors de la mise à jour");
      
      const updated = await res.json();
      setTender(updated.data || updated);
      toast.success("Marché mis à jour avec succès");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  // 3. Fonction de suppression (DELETE)
  async function deleteTender() {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce marché ? Cette action est irréversible.")) return;
    
    try {
      const res = await fetch(`/api/marches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erreur lors de la suppression");
      
      toast.success("Marché supprimé");
      router.push("/administration/marches-publics");
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  // 4. Validation de l'attribution
  const confirmAttribution = () => {
    if (!winnerData.winnerId || winnerData.winnerAmount <= 0) {
      return toast.error("Veuillez saisir un nom de gagnant et un montant valide.");
    }
    updateTender({
      status: "attributed",
      winnerId: winnerData.winnerId,
      winnerAmount: winnerData.winnerAmount,
    });
    setIsAttributing(false);
  };

  if (!tender) return <div className="p-6"><div className="h-32 bg-white rounded-xl animate-pulse"/></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-4">
      {/* HEADER : Retour, Titre et Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <Link href="/administration/marches-publics" className="text-xs text-moss hover:text-ink transition-colors">
            ← Retour aux marchés publics
          </Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-3xl font-bold text-ink">{tender.reference}</h1>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border ${
              tender.status === 'planning' ? 'bg-amber-50 text-amber-600 border-amber-200' : 
              tender.status === 'attributed' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 
              'bg-blue-50 text-blue-600 border-blue-200'
            }`}>
              {tender.status}
            </span>
          </div>
        </div>

        <div className="flex gap-2 w-full md:w-auto">
          {tender.status === 'planning' && (
            <button 
              onClick={() => updateTender({ status: 'published' })}
              disabled={loading}
              className="flex-1 md:flex-none bg-moss text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-ink transition-all disabled:opacity-50"
            >
              Publier l'appel d'offres
            </button>
          )}
          <button 
            onClick={deleteTender}
            className="flex-1 md:flex-none border border-red-200 text-red-500 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-red-50 transition-all"
          >
            Supprimer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLONNE GAUCHE : Détails Techniques */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-clay/20 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-ink mb-4 border-b border-clay/10 pb-2">Détails techniques</h2>
            <div className="space-y-4">
              {[
                ["Objet du marché", tender.object],
                ["Montant Estimé", `${tender.estimatedAmount?.toLocaleString("fr-FR")} XOF`],
                ["Type de procédure", tender.procedure],
                ["Date de création", new Date(tender.createdAt).toLocaleDateString("fr-FR")],
                ["Date limite de dépôt", tender.bidsDeadline ? new Date(tender.bidsDeadline).toLocaleDateString("fr-FR") : "Non définie"]
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col sm:flex-row sm:justify-between gap-1 border-b border-clay/5 pb-2 last:border-0">
                  <span className="text-clay text-sm">{label}</span>
                  <span className="text-ink font-semibold">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COLONNE DROITE : Workflow / Attribution */}
        <div className="space-y-6">
          <div className="bg-sand/20 rounded-2xl border border-clay/20 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-ink mb-4">Suivi & Attribution</h2>
            
            {tender.status === 'attributed' ? (
              <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 space-y-2">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Marché Attribué</p>
                <div>
                  <p className="text-xs text-clay">Titulaire du marché :</p>
                  <p className="font-bold text-ink">{tender.winnerId}</p>
                </div>
                <div>
                  <p className="text-xs text-clay">Montant final :</p>
                  <p className="font-bold text-ink text-lg">{tender.winnerAmount?.toLocaleString("fr-FR")} XOF</p>
                </div>
              </div>
            ) : isAttributing ? (
              <div className="bg-white p-4 rounded-xl border border-moss/30 shadow-inner space-y-4">
                <h3 className="text-sm font-bold text-moss">Saisie de l'adjudicataire</h3>
                <div>
                  <label className="text-[10px] font-bold text-clay uppercase">Nom de l'entreprise</label>
                  <input 
                    type="text" 
                    className="w-full mt-1 p-2 bg-clay/5 border-none rounded-lg text-sm focus:ring-2 focus:ring-moss"
                    placeholder="Ex: Niger Telecom"
                    onChange={(e) => setWinnerData({ ...winnerData, winnerId: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-clay uppercase">Montant final (XOF)</label>
                  <input 
                    type="number" 
                    className="w-full mt-1 p-2 bg-clay/5 border-none rounded-lg text-sm focus:ring-2 focus:ring-moss"
                    onChange={(e) => setWinnerData({ ...winnerData, winnerAmount: Number(e.target.value) })}
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={confirmAttribution} className="flex-1 bg-moss text-white py-2 rounded-lg text-xs font-bold">Confirmer</button>
                  <button onClick={() => setIsAttributing(false)} className="flex-1 bg-clay/10 text-clay py-2 rounded-lg text-xs">Annuler</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-clay italic">
                  Statut actuel : <span className="font-bold text-ink">{tender.status}</span>. 
                  Une fois les plis ouverts et analysés, procédez à l'attribution.
                </p>
                <button 
                  onClick={() => setIsAttributing(true)}
                  disabled={tender.status === 'planning'}
                  className={`w-full py-3 rounded-xl font-bold text-sm shadow-sm transition-all ${
                    tender.status === 'planning' 
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                    : 'bg-ink text-white hover:bg-moss'
                  }`}
                >
                  {tender.status === 'planning' ? "Publication requise" : "Attribuer le marché"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}