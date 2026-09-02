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
  en_attente: { label: "En attente", cls: "bg-amber-50 text-amber-700 border-amber-100", icon: Clock },
  approuve: { label: "Approuvé", cls: "bg-emerald-50 text-emerald-700 border-emerald-100", icon: CheckCircle2 },
  rejete: { label: "Rejeté", cls: "bg-red-50 text-red-700 border-red-100", icon: AlertCircle },
  mandate: { label: "Mandaté", cls: "bg-blue-50 text-blue-700 border-blue-100", icon: FileStack },
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
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-black text-ink uppercase tracking-tight">Engagements</h1>
          <p className="text-xs text-moss font-bold italic">Réservation des crédits budgétaires</p>
        </div>
        <Link href="/administration/budget/engagements/new" className="bg-ink text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-cedar transition-all flex items-center gap-2">
          <Plus size={14} /> Nouvel Engagement
        </Link>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-moss/50" size={16} />
        <input 
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-clay/20 rounded-2xl text-xs outline-none focus:border-cedar transition-all" 
          placeholder="Rechercher une référence ou un bénéficiaire..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-white rounded-[2rem] border border-clay/10 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-sand/10 border-b border-clay/10">
              <th className="p-5 text-[10px] font-black text-moss uppercase tracking-widest">Référence & Date</th>
              <th className="p-5 text-[10px] font-black text-moss uppercase tracking-widest">Objet & Bénéficiaire</th>
              <th className="p-5 text-[10px] font-black text-moss uppercase tracking-widest text-right">Montant (XOF)</th>
              <th className="p-5 text-[10px] font-black text-moss uppercase tracking-widest text-center">Statut</th>
              <th className="p-5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-clay/5">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-20 text-center">
                  <Loader2 className="animate-spin mx-auto text-moss/20" size={32} />
                </td>
              </tr>
            ) : filteredItems.length > 0 ? (
              filteredItems.map((item) => {
                const style = statusStyle[item.status] || statusStyle.en_attente;
                const Icon = style.icon;
                return (
                  <tr key={item._id} className="hover:bg-sand/5 transition-colors group">
                    <td className="p-5">
                      <p className="font-mono text-[10px] font-black text-ink">{item.reference}</p>
                      <p className="text-[9px] text-moss/50 font-bold">{new Date(item.createdAt).toLocaleDateString()}</p>
                    </td>
                    <td className="p-5">
                      <p className="text-xs font-bold text-ink uppercase truncate max-w-[250px]">{item.description}</p>
                      <p className="text-[10px] text-moss font-medium uppercase tracking-tight">{item.provider}</p>
                    </td>
                    <td className="p-5 text-right font-mono text-sm font-black text-cedar">
                      {item.amount.toLocaleString()}
                    </td>
                    <td className="p-5">
                      <div className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-full border w-fit mx-auto ${style.cls}`}>
                        <Icon size={12} />
                        <span className="text-[9px] font-black uppercase tracking-tighter">{style.label}</span>
                      </div>
                    </td>
                    <td className="p-5 text-right">
                      <Link href={`/administration/budget/engagements/${item._id}`} className="p-2 inline-block hover:bg-sand rounded-lg transition-colors text-ink">
                        <Eye size={16} />
                      </Link>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="p-20 text-center text-moss/40 text-[10px] font-black uppercase tracking-[0.2em] italic">
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