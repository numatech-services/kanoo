"use client";
import Link from "next/link";
import { BarChart3, HeartPulse, Landmark, Scissors } from "lucide-react";
import { ScreenTabs } from "@/components/shared/ScreenTabs";
export default function FiscalitePage() {
  const modules = [
    { href:"/fiscalite/tva", icon: <BarChart3 size={20} />, title:"Déclaration TVA", desc:"Mensuelle — taux 19% standard, 10% réduit. Date limite : 20 du mois suivant.", badge:"Mensuelle" },
    { href:"/fiscalite/cnss", icon: <HeartPulse size={20} />, title:"CNSS trimestriel", desc:"Part salariale 3,6% + patronale 16,4%. Date limite : 10 jours après la fin du trimestre.", badge:"Trimestrielle" },
    { href:"/fiscalite/isbic", icon: <Landmark size={20} />, title:"IS/BIC annuel", desc:"Impôt sur les Sociétés 30%. Minimum forfaitaire 1 000 000 FCFA. Acomptes en mars et juillet.", badge:"Annuelle" },
    { href:"/fiscalite/retenues", icon: <Scissors size={20} />, title:"Retenues à la source", desc:"Marchés publics 10%, prestations 5%, honoraires 10%, loyers 5%, dividendes 10%.", badge:"Au fil de l'eau" },
  ];
  return (
    <div className="space-y-6">
      <ScreenTabs group="fiscalite" />
      <div>
        <h1 className="page-title">Fiscalité Niger</h1>
        <p className="text-sm text-ink2 mt-1">DGI Niger · CGI · CNSS · Code des Marchés Publics 2017</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {modules.map(m => (
          <Link key={m.href} href={m.href} className="bg-surface rounded-xl border border-line p-5 hover:border-section/40 hover:shadow-sm transition-all group">
            <div className="flex items-start justify-between mb-3">
              <span className="text-3xl">{m.icon}</span>
              <span className="text-xs bg-surface2 text-ink2 px-2 py-0.5 rounded-full">{m.badge}</span>
            </div>
            <p className="font-semibold text-ink group-hover:text-section transition-colors">{m.title}</p>
            <p className="text-xs text-ink2 mt-1.5 leading-relaxed">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
