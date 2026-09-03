"use client";
import Link from "next/link";
export default function MesOffresPage() {
  return (
    <div className="space-y-5">
      <div><Link href="/portail/fournisseur" className="text-xs text-ink2 hover:text-ink">← Tableau de bord</Link><h1 className="text-2xl font-bold text-ink mt-1">Mes offres déposées</h1></div>
      <div className="bg-surface rounded-xl border border-line p-12 text-center"><p className="text-4xl mb-3">📋</p><p className="text-ink2">Aucune offre déposée pour l'instant.<br/>Consultez les appels d'offres ouverts pour soumettre votre première offre.</p><Link href="/portail/fournisseur/appels-offres" className="inline-block mt-5 px-6 py-2.5 bg-section text-white rounded-xl text-sm font-medium hover:brightness-95">Voir les appels d'offres →</Link></div>
    </div>
  );
}
