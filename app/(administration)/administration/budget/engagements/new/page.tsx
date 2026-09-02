"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, User, FileText } from "lucide-react";
import Link from "next/link";

export default function NewEngagementPage() {
  const router = useRouter();
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(false);

  // État du formulaire
  const [formData, setFormData] = useState({
    chapterId: "",
    objet: "",
    beneficiaire: "",
    montant: "",
    description: "",
  });

 useEffect(() => {
  // On force le paramètre flat=true pour que l'API renvoie le tableau simple
  fetch("/api/budget?flat=true")
    .then((res) => res.json())
    .then((response) => {
      // On teste les deux formats possibles (direct ou enveloppé dans .data)
      const data = response.data || response;
      
      if (Array.isArray(data)) {
        setChapters(data);
        console.log("Chapitres chargés :", data.length);
      } else {
        console.error("Format de données reçu inconnu :", response);
      }
    })
    .catch((err) => console.error("Erreur fetch chapitres :", err));
}, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await fetch("/api/budget/engagements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        router.push("/administration/budget/engagements");
        router.refresh(); // Pour forcer la mise à jour des chiffres
      }
    } catch (err) {
      console.error("Erreur lors de l'enregistrement:", err);
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full bg-sand/20 border border-clay/10 rounded-2xl px-5 py-4 text-sm font-bold outline-none focus:border-cedar focus:bg-white transition-all placeholder:text-moss/30";
  const labelCls = "text-[10px] font-black uppercase tracking-[0.2em] text-moss mb-2 block ml-1";

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      
      {/* Navigation & Titre */}
      <div className="flex items-center justify-between">
        <Link href="/administration/budget/engagements" className="flex items-center gap-2 text-moss hover:text-ink transition-colors group">
          <div className="p-2 rounded-full group-hover:bg-sand transition-colors">
            <ArrowLeft size={18} />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest">Retour</span>
        </Link>
        <h1 className="text-xl font-black text-ink uppercase tracking-tighter">Nouvel Engagement Budgétaire</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-[2.5rem] border border-clay/10 p-10 shadow-sm space-y-10">
        
        {/* Section 1 : Imputation Budgétaire */}
        <section className="space-y-6">
          <div className="flex items-center gap-3 pb-2 border-b border-clay/5">
             <div className="w-8 h-8 rounded-lg bg-cedar/10 flex items-center justify-center text-cedar">
                <FileText size={16} />
             </div>
             <h2 className="text-xs font-black uppercase tracking-widest text-ink">Imputation & Objet</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className={labelCls}>Chapitre Budgétaire</label>
              <select 
                required
                className={inputCls}
                value={formData.chapterId}
                onChange={e => setFormData({...formData, chapterId: e.target.value})}
              >
                <option value="">Sélectionner un chapitre...</option>
                {chapters.map((c: any) => (
                  <option key={c._id} value={c._id}>
                    {c.code} - {c.label} (Disp: {(c.allocatedAmount - c.engagedAmount).toLocaleString()} XOF)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Objet de la dépense</label>
              <input 
                required
                type="text" 
                placeholder="Ex: Achat fournitures bureau..."
                className={inputCls}
                value={formData.objet}
                onChange={e => setFormData({...formData, objet: e.target.value})}
              />
            </div>
          </div>
        </section>

        {/* Section 2 : Bénéficiaire & Montant */}
        <section className="space-y-6">
          <div className="flex items-center gap-3 pb-2 border-b border-clay/5">
             <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600">
                <User size={16} />
             </div>
             <h2 className="text-xs font-black uppercase tracking-widest text-ink">Détails Financiers</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className={labelCls}>Bénéficiaire (Fournisseur/Agent)</label>
              <input 
                required
                type="text" 
                placeholder="Nom de l'entreprise ou personne..."
                className={inputCls}
                value={formData.beneficiaire}
                onChange={e => setFormData({...formData, beneficiaire: e.target.value})}
              />
            </div>
            <div>
              <label className={labelCls}>Montant TTC (XOF)</label>
              <div className="relative">
                <input 
                  required
                  type="number" 
                  placeholder="0"
                  className={`${inputCls} pr-16`}
                  value={formData.montant}
                  onChange={e => setFormData({...formData, montant: e.target.value})}
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[10px] font-black text-moss/40">XOF</span>
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>Justification / Notes complémentaires</label>
            <textarea 
              rows={3}
              placeholder="Détails additionnels sur l'engagement..."
              className={`${inputCls} resize-none`}
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
            />
          </div>
        </section>

        {/* Actions */}
        <div className="pt-6 flex justify-end gap-4">
          <button 
            type="button"
            onClick={() => router.back()}
            className="px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-moss hover:bg-sand transition-all"
          >
            Annuler
          </button>
          <button 
            disabled={loading || !formData.chapterId}
            className="bg-ink text-white px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-cedar transition-all shadow-xl shadow-ink/10 flex items-center gap-3 disabled:opacity-50"
          >
            {loading ? "Traitement..." : <><Save size={16} /> Enregistrer l'engagement</>}
          </button>
        </div>
      </form>
    </div>
  );
}