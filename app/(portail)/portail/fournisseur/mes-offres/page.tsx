"use client";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
export default function MesOffresPage() {
  return (
    <div className="space-y-5">
      <div><Link href="/portail/fournisseur" className="text-xs text-ink2 hover:text-ink">← Tableau de bord</Link><h1 className="page-title mt-1">Mes offres déposées</h1></div>
      <div className="bg-surface rounded-xl border border-line p-12 text-center"><p className="mb-3 text-ink3 flex justify-center" aria-hidden><ClipboardList size={36} /></p><p className="text-ink2">Aucune offre déposée pour l'instant.<br/>Consultez les appels d'offres ouverts pour soumettre votre première offre.</p><Link href="/portail/fournisseur/appels-offres" className={buttonClass("primary", "md", "mt-5")}>Voir les appels d'offres →</Link></div>
    </div>
  );
}
