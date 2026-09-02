"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  ArrowLeft, Printer, CheckCircle, XCircle, 
  Calendar, User, Tag, Wallet, Loader2 
} from "lucide-react";
import Link from "next/link";

export default function EngagementDetailsPage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchEngagement = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/budget/engagements/${id}`);
      const result = await res.json();
      
      // DEBUG : Pour voir ce que l'API renvoie réellement
      console.log("Données reçues de l'API :", result);

      if (!res.ok) {
        setErrorMsg(result.message || "Impossible de charger l'engagement");
      } else {
        // On récupère result.data car ton API enveloppe maintenant la réponse
        setData(result.data || result);
      }
    } catch (err) {
      console.error("Erreur de chargement:", err);
      setErrorMsg("Erreur réseau ou serveur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEngagement();
  }, [id]);

  const handleStatusUpdate = async (newStatus: 'approuve' | 'rejete') => {
    if (!confirm(`Confirmez-vous le passage au statut : ${newStatus}?`)) return;
    
    setUpdating(true);
    try {
      const res = await fetch(`/api/budget/engagements/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (res.ok) {
        await fetchEngagement();
        router.refresh();
      } else {
        const errData = await res.json();
        alert(`Erreur : ${errData.message || "Mise à jour impossible"}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-20 gap-4">
      <Loader2 className="animate-spin text-cedar" size={40} />
      <p className="text-moss font-black uppercase text-[10px] tracking-widest">Chargement du dossier...</p>
    </div>
  );

  // Écran d'erreur si l'engagement n'est pas trouvé ou accès refusé
  if (errorMsg || !data) return (
    <div className="flex flex-col items-center justify-center p-20 gap-6">
        <div className="bg-red-50 text-red-500 p-8 rounded-[2rem] border border-red-100 text-center max-w-md">
            <XCircle size={40} className="mx-auto mb-4 opacity-20" />
            <p className="font-black italic uppercase text-xs">Engagement introuvable</p>
            <p className="text-[10px] opacity-60 font-mono mt-2 break-all">ID: {id}</p>
            <p className="text-[11px] mt-4 font-bold bg-white/50 p-2 rounded-lg">{errorMsg || "Aucune donnée disponible"}</p>
        </div>
        <Link href="/administration/budget/engagements" className="text-[10px] font-black uppercase tracking-widest text-moss hover:text-ink flex items-center gap-2">
            <ArrowLeft size={14} /> Retour à la liste
        </Link>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <Link href="/administration/budget/engagements" className="flex items-center gap-2 text-moss hover:text-ink transition-colors group">
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
          <span className="text-[10px] font-black uppercase tracking-widest">Retour à la liste</span>
        </Link>
        
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sand/50 text-ink text-[10px] font-black uppercase border border-clay/10 hover:bg-sand transition-all">
            <Printer size={14} /> Imprimer
          </button>

          {data.status === 'en_attente' && (
            <>
              <button 
                disabled={updating}
                onClick={() => handleStatusUpdate('rejete')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-600 text-[10px] font-black uppercase border border-red-100 hover:bg-red-100 transition-all disabled:opacity-50"
              >
                <XCircle size={14} /> {updating ? "..." : "Rejeter"}
              </button>
              <button 
                disabled={updating}
                onClick={() => handleStatusUpdate('approuve')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-white text-[10px] font-black uppercase hover:bg-cedar transition-all shadow-lg shadow-ink/10 disabled:opacity-50"
              >
                <CheckCircle size={14} /> {updating ? "..." : "Approuver"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white rounded-[2.5rem] border border-clay/10 p-10 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8">
                <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-tighter 
                  ${data.status === 'en_attente' ? 'bg-amber-50 text-amber-600' : 
                    data.status === 'approuve' ? 'bg-emerald-50 text-emerald-600' : 
                    data.status === 'mandate' ? 'bg-ink text-white' :
                    'bg-red-50 text-red-600'}`}>
                    {data.status?.replace('_', ' ')}
                </span>
            </div>

            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-black text-moss uppercase tracking-[0.2em] mb-1">Référence</p>
                <h2 className="text-3xl font-black text-ink tracking-tighter uppercase">{data.reference || "Non générée"}</h2>
              </div>

              <div className="pt-6 border-t border-clay/5">
                <p className="text-[10px] font-black text-moss uppercase tracking-[0.2em] mb-4">Objet</p>
                <p className="text-xl font-bold text-ink leading-tight">{data.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-8 pt-6">
                <div className="flex items-start gap-3">
                  <div className="p-3 rounded-2xl bg-sand/30 text-moss"><User size={20} /></div>
                  <div>
                    <p className="text-[9px] font-black text-moss/50 uppercase">Bénéficiaire</p>
                    <p className="text-sm font-black text-ink uppercase">{data.provider}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="p-3 rounded-2xl bg-sand/30 text-moss"><Tag size={20} /></div>
                  <div>
                    <p className="text-[9px] font-black text-moss/50 uppercase">Chapitre</p>
                    <p className="text-sm font-black text-ink">{data.chapterCode || "---"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-sand/20 rounded-[2rem] border border-clay/5 p-8">
             <h3 className="text-[10px] font-black text-moss uppercase tracking-widest mb-4">Notes de l'agent</h3>
             <p className="text-sm text-ink/70 leading-relaxed italic">
                {data.notes || "Aucune note particulière jointe."}
             </p>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-ink text-white rounded-[2.5rem] p-10 shadow-xl shadow-ink/20 relative overflow-hidden">
            <Wallet className="absolute -bottom-4 -right-4 text-white/5" size={120} />
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em] mb-2">Montant à engager</p>
            <h3 className="text-4xl font-black tracking-tighter">
              {(data.amount || 0).toLocaleString('fr-FR')} <span className="text-sm font-bold text-white/40">XOF</span>
            </h3>
            <div className="mt-8 pt-6 border-t border-white/10 flex items-center gap-2">
                <Calendar size={14} className="text-white/40" />
                <p className="text-[10px] font-bold text-white/60">
                    {data.createdAt ? `Le ${new Date(data.createdAt).toLocaleDateString()}` : 'Date inconnue'}
                </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}