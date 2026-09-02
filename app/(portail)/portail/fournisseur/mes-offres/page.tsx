"use client";
import Link from "next/link";
export default function MesOffresPage() {
  return (
    <div className="space-y-5">
      <div><Link href="/portail/fournisseur" className="text-xs text-moss hover:text-ink">← Tableau de bord</Link><h1 className="text-2xl font-bold text-ink mt-1">Mes offres déposées</h1></div>
      <div className="bg-white rounded-xl border border-clay/20 p-12 text-center"><p className="text-4xl mb-3">📋</p><p className="text-moss">Aucune offre déposée pour l'instant.<br/>Consultez les appels d'offres ouverts pour soumettre votre première offre.</p><Link href="/portail/fournisseur/appels-offres" className="inline-block mt-5 px-6 py-2.5 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink">Voir les appels d'offres →</Link></div>
    </div>
  );
}
