"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  ArrowLeft, 
  FileText, 
  CheckCircle2, 
  Calendar, 
  User, 
  Wallet,
  Loader2,
  Landmark,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";

interface EngagementData {
  _id: string;
  reference: string;
  description: string;
  amount: number;
  provider: string;
  status: string;
}

// 1. On retire { params } des arguments car on va utiliser useParams()
export default function MandatementActionPage() {
  
  // 2. On récupère l'ID via le hook useParams
  const pathParams = useParams();
  const id = pathParams?.id as string;
  
  const router = useRouter();
  const [data, setData] = useState<EngagementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      try {
        setLoading(true);
        const res = await fetch(`/api/budget/engagements/${id}`);
        const result = await res.json();
        setData(result.data || result);
      } catch (err) {
        console.error("Erreur de chargement:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [id]);

  const handleCreateMandat = async () => {
    if (!data?._id) return;
    if (!confirm("Voulez-vous valider le mandatement de cette dépense ?")) return;
    
    setSubmitting(true);
    try {
      const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
      const res = await fetch(`/api/budget/engagements/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({ status: 'mandate' })
      });

      if (res.ok) {
        router.push("/administration/budget/mandatements");
        router.refresh();
      } else {
        const errData = await res.json();
        alert(errData.error || "Erreur lors du mandatement");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur de connexion au serveur");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-20 gap-4">
      <Loader2 className="animate-spin text-ink" size={40} />
      <p className="text-[10px] font-black uppercase tracking-widest text-ink2">Préparation du mandat...</p>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 p-6">
      
      <div className="flex justify-between items-center">
        <Link href="/administration/budget/mandatements" className="flex items-center gap-2 text-ink2 hover:text-ink transition-colors">
          <ArrowLeft size={18} />
          <span className="text-[10px] font-black uppercase tracking-widest">Retour aux attentes</span>
        </Link>
        <div className="flex items-center gap-2 px-3 py-1 bg-pos-50 text-pos rounded-full border border-pos/25">
          <ShieldCheck size={14} />
          <span className="text-[10px] font-black uppercase">Engagement Approuvé</span>
        </div>
      </div>

      <div className="bg-surface rounded-[2.5rem] border border-line shadow-xl overflow-hidden">
        <div className="bg-ink p-8 text-onink flex justify-between items-center">
          <div>
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em] mb-1">Dossier de Mandatement</p>
            <h1 className="text-2xl font-black tracking-tighter uppercase">Ordre de Paiement</h1>
          </div>
          <Landmark size={40} className="text-white/10" />
        </div>

        <div className="p-10 space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-ink2">
                <User size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest">Bénéficiaire</span>
              </div>
              <p className="text-xl font-black text-ink uppercase pl-6">
                {data?.provider || "---"}
              </p>
            </div>
            <div className="space-y-4 text-right">
              <div className="flex items-center gap-2 text-ink2 justify-end">
                <span className="text-[10px] font-black uppercase tracking-widest">Montant à Ordonnancer</span>
                <Wallet size={16} />
              </div>
              <p className="text-3xl font-black text-section pl-6">
                {data?.amount?.toLocaleString('fr-FR') || "0"} <span className="text-sm">XOF</span>
              </p>
            </div>
          </div>

          <div className="bg-surface2/20 rounded-3xl p-8 border border-line">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[9px] font-black text-ink2/60 uppercase mb-2">Référence d'engagement</p>
                <p className="text-sm font-bold text-ink font-mono">{data?.reference || "---"}</p>
              </div>
              <div>
                <p className="text-[9px] font-black text-ink2/60 uppercase mb-2">Objet du paiement</p>
                <p className="text-sm font-medium text-ink italic">{data?.description || "Aucune description"}</p>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-line flex flex-col items-center gap-4">
            <p className="text-[10px] text-ink2 text-center max-w-sm italic">
              En cliquant sur le bouton ci-dessous, vous validez l'ordre de paiement définitif pour ce bénéficiaire.
            </p>
            <button 
              onClick={handleCreateMandat}
              disabled={submitting || !data}
              className="w-full max-w-md flex items-center justify-center gap-3 bg-ink text-onink py-4 rounded-2xl font-black uppercase text-xs tracking-[0.2em] hover:bg-section transition-all shadow-xl shadow-ink/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <>
                  <CheckCircle2 size={18} />
                  Générer le mandat de paiement
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-8 text-[9px] font-bold text-ink2/40 uppercase tracking-widest">
        <div className="flex items-center gap-1"><FileText size={12} /> Pièces justificatives jointes</div>
        <div className="flex items-center gap-1"><Calendar size={12} /> Exercice Budgétaire {new Date().getFullYear()}</div>
      </div>
    </div>
  );
}