"use client";
import Link from "next/link";
export default function AdherentDocumentsPage() {
  return (
    <div className="space-y-5">
      <div><Link href="/portail/adherent" className="text-xs text-ink2 hover:text-ink">← Mon espace</Link><h1 className="text-2xl font-bold text-ink mt-1">Mes documents</h1></div>
      <div className="bg-surface rounded-xl border border-line p-10 text-center"><p className="text-3xl mb-3">🗂️</p><p className="text-ink2 text-sm">Les documents partagés par votre association apparaîtront ici.</p></div>
    </div>
  );
}
