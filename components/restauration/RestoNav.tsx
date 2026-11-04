"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Store, Tags, Users, ChefHat, CookingPot, ShoppingBasket, CalendarClock, Gauge, ShieldCheck, Truck, Smartphone, Rocket, Calculator } from "lucide-react";

const LINKS = [
  { href: "/restauration", label: "Vue d'ensemble", icon: <LayoutDashboard size={15} /> },
  { href: "/comptoir", label: "Comptoirs (caisse, stock, résultat)", icon: <Store size={15} /> },
  { href: "/restauration/fiches", label: "Fiches techniques", icon: <ChefHat size={15} /> },
  { href: "/restauration/production", label: "Production", icon: <CookingPot size={15} /> },
  { href: "/restauration/achats", label: "Achats", icon: <ShoppingBasket size={15} /> },
  { href: "/restauration/prix", label: "Prix et marges", icon: <Tags size={15} /> },
  { href: "/restauration/equipe", label: "Équipe et paie", icon: <Users size={15} /> },
  { href: "/restauration/planning", label: "Planning", icon: <CalendarClock size={15} /> },
  { href: "/restauration/pilotage", label: "Pilotage", icon: <Gauge size={15} /> },
  { href: "/restauration/hygiene", label: "Hygiène", icon: <ShieldCheck size={15} /> },
  { href: "/restauration/transferts", label: "Transferts", icon: <Truck size={15} /> },
  { href: "/restauration/magasin", label: "Magasin (mobile)", icon: <Smartphone size={15} /> },
  { href: "/restauration/ouverture", label: "Ouverture des sites", icon: <Rocket size={15} /> },
  { href: "/restauration/comptable", label: "Espace comptable", icon: <Calculator size={15} /> },
];

/** Les pages du module Restauration, d'un clic. */
export function RestoNav() {
  const path = usePathname();
  return (
    // Téléphone : une seule ligne qui défile ; écran large : boutons sur plusieurs lignes.
    <nav aria-label="Module restauration" className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0 sm:flex-wrap sm:overflow-visible">
      {LINKS.map(l => {
        const on = path === l.href;
        return (
          <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined}
            className={`h-9 px-3.5 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap ${on ? "bg-ink text-white border-ink" : "border-line text-ink2 hover:bg-surface2"}`}>
            {l.icon} {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
