"use client";

import Link from "next/link";
import { BarChart3, BookOpen, Landmark, Receipt, Scale, TrendingUp, PieChart, Layers, Warehouse, Users, Store, CreditCard, FileDown, Repeat } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useMe, meCan } from "@/lib/useMe";
import { resourceForHref } from "@/lib/nav-resources";
import { moduleEnabled } from "@/lib/modules";
import { sectionForPath } from "@/lib/sections";

interface Report {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
  /** Ressource exigée quand le lien n'est pas un écran du menu (export PDF…). */
  resource?: string;
}

const now = new Date();
const GROUPS: Array<{ title: string; items: Report[] }> = [
  { title: "Activité commerciale", items: [
    { title: "Rentabilité des marchés", desc: "Devis, facturé, dépenses engagées et réalisées, marge de chaque marché.", href: "/contracts/rentabilite", icon: <BarChart3 size={18} /> },
    { title: "Factures en retard", desc: "Impayés échus, à relancer.", href: "/invoices?overdue=true", icon: <Receipt size={18} /> },
    { title: "Recouvrement", desc: "Relances, barème, délai moyen de paiement.", href: "/relances", icon: <TrendingUp size={18} /> },
  ]},
  { title: "Finance", items: [
    { title: "États comptables", desc: "Balance, grand livre, bilan et compte de résultat, export CSV.", href: "/accounting/etats", icon: <BookOpen size={18} /> },
    { title: "Prévision de trésorerie", desc: "Encaissements et décaissements attendus, solde projeté.", href: "/treasury/prevision", icon: <Landmark size={18} /> },
    { title: "Évolution sur 12 mois", desc: "Produits, charges et résultat mois par mois.", href: "/analytics", icon: <TrendingUp size={18} /> },
    { title: "Rentabilité par secteur", desc: "Résultat de chaque secteur d'activité.", href: "/analytique", icon: <Layers size={18} /> },
    { title: "Budget prévisionnel", desc: "Réalisé contre budget, écarts et projection de l'exercice.", href: "/budget-previsionnel", icon: <PieChart size={18} /> },
  ]},
  { title: "Fiscalité", items: [
    { title: "Déclaration de TVA", desc: "TVA collectée, déductible et nette du mois.", href: "/fiscalite/tva", icon: <Scale size={18} /> },
    { title: "TVA du mois — PDF DGI", desc: "Formulaire prêt à déposer, net des avoirs.", icon: <FileDown size={18} />, resource: "fiscalDeclarations",
      href: `/api/reports/dgi-pdf?type=tva&annee=${now.getFullYear()}&mois=${now.getMonth() + 1}` },
    { title: "IS / BIC annuel", desc: "Résultat fiscal et impôt de l'exercice.", href: "/fiscalite/isbic", icon: <Landmark size={18} /> },
    { title: "Retenues à la source", desc: "Retenues subies et opérées, à reverser.", href: "/fiscalite/retenues", icon: <Scale size={18} /> },
  ]},
  { title: "Stock & équipe", items: [
    { title: "Stock et valorisation", desc: "Quantités, valeur au coût moyen, articles sous le seuil.", href: "/stock", icon: <Warehouse size={18} /> },
    { title: "Bulletins de paie", desc: "Masse salariale, cotisations et impôt sur salaires.", href: "/payslips", icon: <Users size={18} /> },
  ]},
  { title: "Modules", items: [
    { title: "Comptoirs", desc: "Ventes, marge et arrêtés de caisse par comptoir.", href: "/comptoir", icon: <Store size={18} /> },
    { title: "Cartes ISIC", desc: "Lots, coûts d'impression et marge par lot.", href: "/isic", icon: <CreditCard size={18} /> },
    { title: "Revente de licences", desc: "Marge et rapprochement du portefeuille.", href: "/abonnements", icon: <Repeat size={18} /> },
  ]},
];

/**
 * Point d'entrée unique des états : ils étaient éparpillés entre Finance,
 * Fiscalité, Contrats et les modules, sans endroit où les trouver tous.
 * N'apparaît que ce que le rôle peut ouvrir et ce que l'organisation exerce.
 */
export default function RapportsPage() {
  const { resources, loading, tenant } = useMe();
  const allowed = (r: Report) => {
    if (!moduleEnabled(r.href, tenant?.disabledModules)) return false;
    const res = r.resource ?? resourceForHref(r.href);
    return !res || loading || resources.length === 0 || meCan(resources, res);
  };
  const groups = GROUPS.map(g => ({ ...g, items: g.items.filter(allowed) })).filter(g => g.items.length > 0);

  return (
    <div className="space-y-8">
      <PageHeader title="Rapports" subtitle="Tous les états de votre activité au même endroit." />
      {groups.length === 0 && <p className="text-sm text-ink2">Votre rôle ne donne accès à aucun rapport.</p>}
      {groups.map(g => (
        <section key={g.title} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink3">{g.title}</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {g.items.map(r => {
              const external = r.href.startsWith("/api/");
              const cls = "surface-card p-4 flex gap-3 hover:border-section/40 transition-colors group";
              const body = (
                <>
                  <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-section-soft text-section">{r.icon}</span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-sm text-ink group-hover:text-section">{r.title}</span>
                    <span className="block text-xs text-ink2 mt-0.5 leading-relaxed">{r.desc}</span>
                  </span>
                </>
              );
              return (
                <div key={r.href} data-section={sectionForPath(r.href.split("?")[0])}>
                  {external
                    ? <a href={r.href} target="_blank" rel="noopener noreferrer" className={cls}>{body}</a>
                    : <Link href={r.href} className={cls}>{body}</Link>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
