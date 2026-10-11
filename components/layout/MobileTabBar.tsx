"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Bell, Menu } from "lucide-react";
import { useMe } from "@/lib/useMe";

/**
 * Barre du bas sur téléphone : accueil de l'espace, recherche (⌘K), alertes,
 * menu complet (tiroir). Masquée sur grand écran, où le menu latéral est visible.
 */
export function MobileTabBar({ home }: { home: string }) {
  const pathname = usePathname() ?? "";
  // Pages partagées (/activites, /projects…) : l'accueil suit le type de structure.
  const { tenant } = useMe();
  const target = tenant?.type === "association" ? "/associations/dashboard" : tenant?.type === "administration" ? "/administration/dashboard" : home;
  const item = "flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium min-h-[52px]";
  const active = (on: boolean) => (on ? "text-section" : "text-ink2");
  return (
    <nav aria-label="Navigation rapide"
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line flex"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <Link href={target} className={`${item} ${active(pathname === target)}`}><Home size={20} />Accueil</Link>
      <button type="button" className={`${item} ${active(false)}`}
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}><Search size={20} />Rechercher</button>
      <Link href="/notifications" className={`${item} ${active(pathname.startsWith("/notifications"))}`}><Bell size={20} />Alertes</Link>
      <button type="button" className={`${item} ${active(false)}`} onClick={() => window.dispatchEvent(new Event("kanoo:nav"))}><Menu size={20} />Menu</button>
    </nav>
  );
}
