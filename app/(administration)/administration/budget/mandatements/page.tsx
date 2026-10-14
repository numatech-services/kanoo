"use client";

import { useState, useEffect } from "react";
import { FileCheck, Search, ArrowUpRight, Loader2, Landmark, Printer } from "lucide-react";
import Link from "next/link";

interface Mandat {
  _id: string;
  reference: string;
  description: string;
  amount: number;
  provider: string;
  status: string;
  mandatedAt?: string;
}

export default function MandatementsPage() {
  const [items, setItems] = useState<Mandat[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  // « À mandater » = engagements approuvés en attente ; « Émis » = déjà mandatés.
  const [tab, setTab] = useState<"approuve" | "mandate">("approuve");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/budget/engagements?status=${tab}`, { credentials: "include" })
      .then((r) => r.json())
      .then((response) => {
        const data = response.data || response;
        // La liste peut renvoyer tous les engagements : on filtre par statut au cas où.
        setItems(Array.isArray(data) ? data.filter((x: Mandat) => x.status === tab) : []);
      })
      .catch((err) => console.error("Erreur chargement:", err))
      .finally(() => setLoading(false));
  }, [tab]);

  const filteredItems = items.filter(item => 
    item.reference?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.provider?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 rise">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="page-title">Mandatements</h1>
          <p className="text-xs text-ink2 font-bold italic">Ordres de paiement et mise en règlement</p>
        </div>
        <div className="flex gap-2">
            <div className="bg-surface px-4 py-2 rounded-xl border border-line flex items-center gap-2">
                <Landmark size={14} className="text-ink2" />
                <span className="text-[10px] font-black uppercase text-ink">{items.length} {tab === "approuve" ? "à mandater" : "mandats émis"}</span>
            </div>
        </div>
      </div>

      {/* Onglets : à mandater / émis */}
      <div className="flex gap-1 border-b border-line">
        {([["approuve", "À mandater"], ["mandate", "Mandats émis"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === k ? "border-section text-section" : "border-transparent text-ink2 hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Barre de recherche */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink2/50" size={16} />
        <input 
          className="w-full pl-10 pr-4 py-3 bg-surface border border-line rounded-2xl text-xs outline-none focus:border-section shadow-sm transition-all" 
          placeholder="Rechercher un mandat ou un bénéficiaire..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-surface rounded-[2rem] border border-line p-4 md:p-8 min-h-[400px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="animate-spin text-section" size={32} />
            <p className="text-[10px] font-black uppercase tracking-widest text-ink2">Chargement des mandats...</p>
          </div>
        ) : filteredItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {filteredItems.map((item) => (
              <Link 
                key={item._id} 
                href={`/administration/budget/mandatements/${item._id}`}
                className="flex items-center justify-between p-6 bg-surface2/10 rounded-3xl border border-line hover:border-section/30 hover:bg-surface hover:shadow-xl hover:shadow-section/5 transition-all group"
              >
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center shadow-sm group-hover:bg-section group-hover:text-white transition-all">
                    <FileCheck size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-black text-section uppercase tracking-widest bg-section/5 px-2 py-0.5 rounded">M-{item.reference}</span>
                        <span className="text-[9px] font-bold text-ink2/50 uppercase">
                            {item.mandatedAt ? new Date(item.mandatedAt).toLocaleDateString() : 'Date à confirmer'}
                        </span>
                    </div>
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">{item.description}</h3>
                    <p className="text-[10px] font-bold text-ink2 mt-0.5 tracking-wide">{item.provider}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-8">
                    <div className="text-right">
                        <p className="text-lg font-black text-ink font-mono tracking-tighter">
                            {item.amount.toLocaleString("fr-FR")} <span className="text-[10px] text-ink2/40">FCFA</span>
                        </p>
                        <p className="text-[9px] font-black text-pos uppercase flex items-center justify-end gap-1">
                            <span className="w-1.5 h-1.5 bg-pos rounded-full animate-pulse"></span>
                            Prêt pour règlement
                        </p>
                    </div>
                    <div className="p-3 rounded-full bg-surface2/50 text-ink3 group-hover:bg-section group-hover:text-white transition-all">
                        <ArrowUpRight size={20} />
                    </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center space-y-4">
            <div className="w-16 h-16 bg-surface2/50 rounded-full flex items-center justify-center mx-auto text-ink2/30">
                <Printer size={32} />
            </div>
            <p className="text-[10px] font-semibold text-ink2/40 uppercase tracking-[0.3em]">
                Aucun mandat émis pour le moment
            </p>
          </div>
        )}
      </div>
    </div>
  );
}