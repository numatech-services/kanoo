"use client";
import Link from "next/link";
export default function AdherentCotisationsPage() {
  return (
    <div className="space-y-5">
      <div><Link href="/portail/adherent" className="text-xs text-ink2 hover:text-ink">← Mon espace</Link><h1 className="text-2xl font-bold text-ink mt-1">Mes cotisations</h1></div>
      <p className="text-ink2 text-sm">L'historique complet de vos cotisations est visible depuis le tableau de bord.</p>
      <Link href="/portail/adherent" className="inline-block px-5 py-2.5 bg-section text-white rounded-xl text-sm font-medium hover:brightness-95">← Retour</Link>
    </div>
  );
}
