"use client";

import { useState, useEffect } from "react";
import { FileStack, Plus, Search, Clock, CheckCircle2, AlertCircle, Eye, Loader2 } from "lucide-react";
import Link from "next/link";

interface Engagement {
  _id: string;
  reference: string; // Vérifie que c'est 'reference' et non 'ref' selon ton modèle
  description: string; // Vérifie que c'est 'description' et non 'objet'
  amount: number;
  chapterCode: string;
  provider: string;
  status: 'en_attente' | 'approuve' | 'rejete' | 'mandate';
  createdAt: string;
}

const statusStyle = {
  en_attente: { label: "En attente", cls: "bg-warn-50 text-warn border-warn/25", icon: Clock },
  approuve: { label: "Approuvé", cls: "bg-pos-50 text-pos border-pos/25", icon: CheckCircle2 },
  rejete: { label: "Rejeté", cls: "bg-neg-50 text-neg border-neg/25", icon: AlertCircle },
  mandate: { label: "Mandaté", cls: "bg-info-50 text-info border-info/25", icon: FileStack },
};

export default function EngagementsPage() {
  const [items, setItems] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchEngagements = async () => {
      try {
        const res = await fetch("/api/budget/engagements");
        const response = await res.json();
        // Gestion du helper ok() : les données sont dans .data ou direct
        const data = response.data || response;
        if (Array.isArray(data)) setItems(data);
      } catch (err) {
        console.error("Erreur:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchEngagements();
  }, []);

  // Filtrage local pour la recherche
  const filteredItems = items.filter(item => 
    item.reference?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.provider?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 rise">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-black text-ink uppercase tracking-tight">Engagements</h1>
          <p className="text-xs text-ink2 font-bold italic">Réservation des crédits budgétaires</p>
        </div>
        <Link href="/administration/budget/engagements/new" className="bg-ink text-onink px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-section transition-all flex items-center gap-2">
          <Plus size={14} /> Nouvel Engagement
        </Link>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink2/50" size={16} />
        <input 
          className="w-full pl-10 pr-4 py-2.5 bg-surface border border-line rounded-2xl text-xs outline-none focus:border-section transition-all" 
          placeholder="Rechercher une référence ou un bénéficiaire..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-surface rounded-[2rem] border border-line overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface2/10 border-b border-line">
              <th className="p-5 text-[10px] font-black text-ink2 uppercase tracking-widest">Référence & Date</th>
              <th className="p-5 text-[10px] font-black text-ink2 uppercase tracking-widest">Objet & Bénéficiaire</th>
              <th className="p-5 text-[10px] font-black text-ink2 uppercase tracking-widest text-right">Montant (XOF)</th>
              <th className="p-5 text-[10px] font-black text-ink2 uppercase tracking-widest text-center">Statut</th>
              <th className="p-5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-20 text-center">
                  <Loader2 className="animate-spin mx-auto text-ink2/20" size={32} />
                </td>
              </tr>
            ) : filteredItems.length > 0 ? (
              filteredItems.map((item) => {
                const style = statusStyle[item.status] || statusStyle.en_attente;
                const Icon = style.icon;
                return (
                  <tr key={item._id} className="hover:bg-surface2/5 transition-colors group">
                    <td className="p-5">
                      <p className="font-mono text-[10px] font-black text-ink">{item.reference}</p>
                      <p className="text-[9px] text-ink2/50 font-bold">{new Date(item.createdAt).toLocaleDateString()}</p>
                    </td>
                    <td className="p-5">
                      <p className="text-xs font-bold text-ink uppercase truncate max-w-[250px]">{item.description}</p>
                      <p className="text-[10px] text-ink2 font-medium uppercase tracking-tight">{item.provider}</p>
                    </td>
                    <td className="p-5 text-right font-mono text-sm font-black text-section">
                      {item.amount.toLocaleString()}
                    </td>
                    <td className="p-5">
                      <div className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-full border w-fit mx-auto ${style.cls}`}>
                        <Icon size={12} />
                        <span className="text-[9px] font-black uppercase tracking-tighter">{style.label}</span>
                      </div>
                    </td>
                    <td className="p-5 text-right">
                      <Link href={`/administration/budget/engagements/${item._id}`} className="p-2 inline-block hover:bg-surface2 rounded-lg transition-colors text-ink">
                        <Eye size={16} />
                      </Link>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="p-20 text-center text-ink2/40 text-[10px] font-black uppercase tracking-[0.2em] italic">
                  Aucun engagement trouvé
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}