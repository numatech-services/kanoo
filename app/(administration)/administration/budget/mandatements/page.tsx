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

  // Récupérer les engagements déjà mandatés
  useEffect(() => {
    const fetchMandats = async () => {
      try {
        const res = await fetch("/api/budget/engagements?status=mandate");
        const response = await res.json();
        const data = response.data || response;
        if (Array.isArray(data)) setItems(data);
      } catch (err) {
        console.error("Erreur chargement mandats:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMandats();
  }, []);

  const filteredItems = items.filter(item => 
    item.reference?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.provider?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-black text-ink uppercase tracking-tight">Mandatements</h1>
          <p className="text-xs text-moss font-bold italic">Ordres de paiement et mise en règlement</p>
        </div>
        <div className="flex gap-2">
            <div className="bg-white px-4 py-2 rounded-xl border border-clay/10 flex items-center gap-2">
                <Landmark size={14} className="text-moss" />
                <span className="text-[10px] font-black uppercase text-ink">{items.length} Mandats émis</span>
            </div>
        </div>
      </div>

      {/* Barre de recherche */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-moss/50" size={16} />
        <input 
          className="w-full pl-10 pr-4 py-3 bg-white border border-clay/10 rounded-2xl text-xs outline-none focus:border-cedar shadow-sm transition-all" 
          placeholder="Rechercher un mandat ou un bénéficiaire..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-white rounded-[2rem] border border-clay/10 p-4 md:p-8 min-h-[400px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="animate-spin text-cedar" size={32} />
            <p className="text-[10px] font-black uppercase tracking-widest text-moss">Chargement des mandats...</p>
          </div>
        ) : filteredItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {filteredItems.map((item) => (
              <Link 
                key={item._id} 
                href={`/administration/budget/mandatements/${item._id}`}
                className="flex items-center justify-between p-6 bg-sand/10 rounded-3xl border border-clay/5 hover:border-cedar/30 hover:bg-white hover:shadow-xl hover:shadow-cedar/5 transition-all group"
              >
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center shadow-sm group-hover:bg-cedar group-hover:text-white transition-all">
                    <FileCheck size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-black text-cedar uppercase tracking-widest bg-cedar/5 px-2 py-0.5 rounded">M-{item.reference}</span>
                        <span className="text-[9px] font-bold text-moss/50 uppercase">
                            {item.mandatedAt ? new Date(item.mandatedAt).toLocaleDateString() : 'Date à confirmer'}
                        </span>
                    </div>
                    <h3 className="text-sm font-black text-ink uppercase tracking-tight">{item.description}</h3>
                    <p className="text-[10px] font-bold text-moss mt-0.5 tracking-wide">{item.provider}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-8">
                    <div className="text-right">
                        <p className="text-lg font-black text-ink font-mono tracking-tighter">
                            {item.amount.toLocaleString()} <span className="text-[10px] text-moss/40">XOF</span>
                        </p>
                        <p className="text-[9px] font-black text-green-600 uppercase flex items-center justify-end gap-1">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                            Prêt pour règlement
                        </p>
                    </div>
                    <div className="p-3 rounded-full bg-sand/50 text-clay group-hover:bg-cedar group-hover:text-white transition-all">
                        <ArrowUpRight size={20} />
                    </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center space-y-4">
            <div className="w-16 h-16 bg-sand/50 rounded-full flex items-center justify-center mx-auto text-moss/30">
                <Printer size={32} />
            </div>
            <p className="text-[10px] font-black text-moss/40 uppercase tracking-[0.3em] italic">
                Aucun mandat émis pour le moment
            </p>
          </div>
        )}
      </div>
    </div>
  );
}