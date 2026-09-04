"use client";

import { useState, useEffect } from "react";
import { 
  Users, 
  CreditCard, 
  Heart, 
  Folder, 
  TrendingUp, 
  AlertCircle,
  ChevronRight,
  Activity,
  ArrowUpRight,
  Building2,
  Megaphone
} from "lucide-react";
import Link from "next/link";
import { UpcomingAgenda } from "@/components/agenda/UpcomingAgenda";

interface DashboardStats {
  activeMembers: number;
  totalContributions: number;
  totalDonations: number;
  activeProjects: number;
  pendingContributionsCount: number;
}

export default function AssoDashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const formatFCFA = (amount: number) => {
    return new Intl.NumberFormat("fr-FR").format(amount) + " FCFA";
  };

  useEffect(() => {
    setMounted(true);
    const fetchDashboard = async () => {
      try {
        const res = await fetch("/api/stats/dashboard", { credentials: "include" });
        const d = await res.json();
        if (d.success) setStats(d.data);
      } catch (err) {
        console.error("Erreur stats dashboard:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (!mounted) return null;

  // Configuration des cartes basée sur tes sections réelles
  const kpiCards = [
    { 
      label: "Adhérents", 
      value: stats?.activeMembers ?? 0, 
      sub: "Membres actifs en base",
      icon: Users, 
      color: "text-info",
      bg: "bg-info-50",
      link: "/associations/membres"
    },
    { 
      label: "Cotisations", 
      value: loading ? "..." : formatFCFA(stats?.totalContributions || 0), 
      sub: "Collectées cette année",
      icon: CreditCard, 
      color: "text-pos",
      bg: "bg-pos-50",
      link: "/associations/cotisations"
    },
    { 
      label: "Dons & Mécénat", 
      value: loading ? "..." : formatFCFA(stats?.totalDonations || 0), 
      sub: "Fonds récoltés",
      icon: Heart, 
      color: "text-section",
      bg: "bg-section-soft",
      link: "/associations/dons"
    },
    { 
      label: "Projets / ONG", 
      value: stats?.activeProjects ?? 0, 
      sub: "Activités en cours",
      icon: Folder, 
      color: "text-warn",
      bg: "bg-warn-50",
      link: "/projects"
    },
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-4 pb-20 animate-in fade-in duration-700">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-3xl font-black text-ink tracking-tighter uppercase italic">Tableau de bord</h1>
          <p className="text-xs font-bold text-ink2 uppercase tracking-[0.2em] mt-1">Gestion Association & Gouvernance</p>
        </div>
        <div className="text-[10px] font-black text-ink uppercase tracking-widest bg-surface2 px-4 py-2 rounded-full border border-line shadow-sm">
          SITUATION AU {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()}
        </div>
      </div>

      {/* KPI GRID (Bento Style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <Link href={card.link} key={card.label} className="bg-surface rounded-[2rem] border border-line p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all group">
            <div className="flex flex-col gap-5">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${card.bg}`}>
                <card.icon className={`w-6 h-6 ${card.color}`} strokeWidth={2.5} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black text-ink2 uppercase tracking-widest">{card.label}</p>
                <p className="text-2xl font-black text-ink tracking-tighter">
                    {loading ? <span className="h-7 w-24 bg-surface2 animate-pulse block rounded-lg" /> : card.value}
                </p>
                <p className="text-[9px] text-ink2/50 font-bold uppercase">{card.sub}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <UpcomingAgenda agendaHref="/associations/agenda" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ANALYSE FINANCIÈRE */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface rounded-[2.5rem] border border-line overflow-hidden shadow-sm">
            <div className="px-8 py-6 border-b border-line flex justify-between items-center bg-surface2/5">
              <h2 className="text-[10px] font-black text-ink uppercase tracking-[0.2em] flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-section" /> Flux des revenus (FCFA)
              </h2>
            </div>
            
            <div className="p-10">
              {/* Simulation graphique pour le visuel */}
              <div className="h-40 flex items-end justify-between gap-2 border-b border-line pb-2">
                {[40, 70, 45, 90, 65, 80, 50, 85, 95, 60, 75, 100].map((h, i) => (
                  <div key={i} className="flex-1 bg-section/10 rounded-t-lg transition-all hover:bg-section/30 group relative">
                    <div className="absolute bottom-0 w-full bg-section rounded-t-lg" style={{ height: `${h}%` }}></div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-4">
                 <span className="text-[8px] font-black text-ink2/40 uppercase">Janvier</span>
                 <span className="text-[8px] font-black text-ink2/40 uppercase">Décembre</span>
              </div>
            </div>
          </div>

          {/* DERNIÈRES ACTIVITÉS */}
          <div className="bg-surface rounded-[2.5rem] border border-line p-8 shadow-sm">
             <h3 className="text-[10px] font-black text-ink uppercase tracking-widest mb-6 flex items-center gap-2">
                <Activity size={16} className="text-section" /> Journal des opérations
             </h3>
             <div className="space-y-4">
                {[1, 2, 3].map((_, i) => (
                  <div key={i} className="flex items-center justify-between py-4 border-b border-line last:border-0">
                    <div className="flex items-center gap-4">
                      <div className="w-2 h-2 rounded-full bg-section animate-pulse"></div>
                      <div>
                        <p className="text-xs font-bold text-ink">Action enregistrée sur le module {i === 1 ? 'Membres' : 'Cotisations'}</p>
                        <p className="text-[10px] text-ink2 opacity-50 font-mono">ID-REF-{2026+i}</p>
                      </div>
                    </div>
                    <span className="text-[9px] font-bold text-ink2">IL Y A {i+1}H</span>
                  </div>
                ))}
             </div>
          </div>
        </div>

        {/* GOUVERNANCE & ACTIONS */}
        <div className="space-y-6">
          <div className="bg-ink text-white rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden">
            <div className="relative z-10">
                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] mb-8 flex items-center gap-2 text-white/60">
                <AlertCircle className="w-4 h-4 text-white" /> Centre de Contrôle
                </h2>
                
                <div className="space-y-3">
                    <Link href="/associations/cotisations?status=unpaid" className="flex items-center gap-4 p-4 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group">
                        <div className="w-10 h-10 rounded-2xl bg-neg/20 flex items-center justify-center shrink-0">
                            <CreditCard className="w-5 h-5 text-neg" />
                        </div>
                        <div className="flex-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-white">Retards</p>
                            <p className="text-lg font-black text-white tracking-tighter">{stats?.pendingContributionsCount || 0} Impayés</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-white/20 group-hover:translate-x-1 transition-transform" />
                    </Link>

                    <Link href="/associations/assemblee" className="flex items-center gap-4 p-4 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group">
                        <div className="w-10 h-10 rounded-2xl bg-info/20 flex items-center justify-center shrink-0">
                            <Megaphone className="w-5 h-5 text-info" />
                        </div>
                        <div className="flex-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-white">Gouvernance</p>
                            <p className="text-[9px] text-white/40 font-bold uppercase mt-1">Organiser une AG</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-white/20 group-hover:translate-x-1 transition-transform" />
                    </Link>
                </div>

                <div className="mt-8 pt-6 border-t border-white/10">
                    <button className="w-full py-4 bg-section text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-surface hover:text-ink transition-all shadow-lg active:scale-95">
                        Exporter Bilan Financier
                    </button>
                </div>
            </div>
          </div>

          {/* LIENS RAPIDES VERS BUREAU & MESSAGES */}
          <div className="bg-surface2/30 rounded-[2.5rem] border border-line p-8">
             <p className="text-[10px] font-black text-ink2 uppercase tracking-widest mb-6 italic">Accès Gouvernance</p>
             <div className="space-y-3">
                <Link href="/associations/bureau" className="flex items-center justify-between p-4 bg-surface rounded-2xl border border-line hover:border-section transition-all group">
                    <div className="flex items-center gap-3">
                        <Building2 size={16} className="text-section" />
                        <span className="text-[10px] font-black text-ink uppercase">Le Bureau</span>
                    </div>
                    <ArrowUpRight size={14} className="text-ink2/30 group-hover:text-section" />
                </Link>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}