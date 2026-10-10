"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMe, meCan } from "@/lib/useMe";
import { resourceForHref } from "@/lib/nav-resources";

/**
 * Garde d'écran : même règle que le menu. Une page dont le compte n'a pas le
 * droit s'affiche « accès refusé » au lieu de s'ouvrir vide (« 0 facture »),
 * ce qui laissait croire à des données manquantes. L'API reste seule juge ;
 * ceci n'est que l'affichage.
 */
export function PageGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { resources, loading, user } = useMe();
  const res = resourceForHref(pathname);
  // Droits pas encore lus (ou lecture en échec) : on n'ampute rien.
  if (!res || loading || !user || resources.length === 0 || meCan(resources, res)) return <>{children}</>;
  return (
    <div className="max-w-lg mx-auto mt-16 surface-card p-6 text-center space-y-3">
      <h1 className="text-lg font-bold text-ink">Accès refusé</h1>
      <p className="text-sm text-ink2">Votre profil n&apos;a pas accès à cet écran. Si vous en avez besoin, demandez ce droit à l&apos;administrateur de votre organisation.</p>
      <Link href="/" className="inline-block text-sm font-semibold text-section hover:underline">Retour à l&apos;accueil</Link>
    </div>
  );
}
