"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Bell, Menu, ReceiptText, Users, CalendarClock, MoreHorizontal } from "lucide-react";
import { useMe } from "@/lib/useMe";

/**
 * Barre du bas sur téléphone (charte v5) : flottante, élément actif en pastille.
 * Entreprise : accueil, factures, clients, agenda, et « Plus » pour le menu
 * complet. Associations et administrations : accueil, recherche, alertes, menu.
 * Masquée sur grand écran, où le menu latéral est visible.
 */
export function MobileTabBar({ home }: { home: string }) {
  const pathname = usePathname() ?? "";
  // Pages partagées (/activites, /projects…) : l'accueil suit le type de structure.
  const { tenant } = useMe();
  const target = tenant?.type === "association" ? "/associations/dashboard" : tenant?.type === "administration" ? "/administration/dashboard" : home;
  const pme = target === "/dashboard";
  const item = "flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold min-h-[54px] rounded-2xl transition-colors";
  const active = (on: boolean) => (on ? "bg-accent-50 text-accent" : "text-ink2");
  const on = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const openMenu = () => window.dispatchEvent(new Event("kanoo:nav"));
  return (
    <nav aria-label="Navigation rapide"
      className="lg:hidden fixed bottom-3 inset-x-3 z-30 bg-surface/95 backdrop-blur border border-line rounded-[22px] shadow-shell flex p-1.5 gap-1"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <Link href={target} className={`${item} ${active(pathname === target)}`}><Home size={20} />Accueil</Link>
      {pme ? (
        <>
          <Link href="/invoices" className={`${item} ${active(on("/invoices"))}`}><ReceiptText size={20} />Factures</Link>
          <Link href="/clients" className={`${item} ${active(on("/clients"))}`}><Users size={20} />Clients</Link>
          <Link href="/agenda" className={`${item} ${active(on("/agenda"))}`}><CalendarClock size={20} />Agenda</Link>
          <button type="button" className={`${item} ${active(false)}`} onClick={openMenu}><MoreHorizontal size={20} />Plus</button>
        </>
      ) : (
        <>
          <button type="button" className={`${item} ${active(false)}`}
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}><Search size={20} />Rechercher</button>
          <Link href="/notifications" className={`${item} ${active(on("/notifications"))}`}><Bell size={20} />Alertes</Link>
          <button type="button" className={`${item} ${active(false)}`} onClick={openMenu}><Menu size={20} />Menu</button>
        </>
      )}
    </nav>
  );
}
