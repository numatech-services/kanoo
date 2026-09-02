"use client";
import Link from "next/link";
export default function FiscalitePage() {
  const modules = [
    { href:"/fiscalite/tva", icon:"📊", title:"Déclaration TVA", desc:"Mensuelle — taux 19% standard, 10% réduit. Date limite : 20 du mois suivant.", badge:"Mensuelle" },
    { href:"/fiscalite/cnss", icon:"🏥", title:"CNSS trimestriel", desc:"Part salariale 3,6% + patronale 16,4%. Date limite : 10 jours après la fin du trimestre.", badge:"Trimestrielle" },
    { href:"/fiscalite/isbic", icon:"🏦", title:"IS/BIC annuel", desc:"Impôt sur les Sociétés 30%. Minimum forfaitaire 1 000 000 XOF. Acomptes en mars et juillet.", badge:"Annuelle" },
    { href:"/fiscalite/retenues", icon:"✂️", title:"Retenues à la source", desc:"Marchés publics 10%, prestations 5%, honoraires 10%, loyers 5%, dividendes 10%.", badge:"Au fil de l'eau" },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Fiscalité Niger</h1>
        <p className="text-sm text-moss mt-1">DGI Niger · CGI · CNSS · Code des Marchés Publics 2017</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {modules.map(m => (
          <Link key={m.href} href={m.href} className="bg-white rounded-xl border border-clay/20 p-5 hover:border-cedar/40 hover:shadow-sm transition-all group">
            <div className="flex items-start justify-between mb-3">
              <span className="text-3xl">{m.icon}</span>
              <span className="text-xs bg-clay/20 text-moss px-2 py-0.5 rounded-full">{m.badge}</span>
            </div>
            <p className="font-semibold text-ink group-hover:text-cedar transition-colors">{m.title}</p>
            <p className="text-xs text-moss mt-1.5 leading-relaxed">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
