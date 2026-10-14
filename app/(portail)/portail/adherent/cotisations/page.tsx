"use client";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button-class";
export default function AdherentCotisationsPage() {
  return (
    <div className="space-y-5">
      <div><Link href="/portail/adherent" className="text-xs text-ink2 hover:text-ink">← Mon espace</Link><h1 className="page-title mt-1">Mes cotisations</h1></div>
      <p className="text-ink2 text-sm">L'historique complet de vos cotisations est visible depuis le tableau de bord.</p>
      <Link href="/portail/adherent" className={buttonClass("primary", "md")}>← Retour</Link>
    </div>
  );
}
