"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Store, Tags, Users } from "lucide-react";

const LINKS = [
  { href: "/restauration", label: "Vue d'ensemble", icon: <LayoutDashboard size={15} /> },
  { href: "/comptoir", label: "Comptoirs (caisse, stock, résultat)", icon: <Store size={15} /> },
  { href: "/restauration/prix", label: "Prix et marges", icon: <Tags size={15} /> },
  { href: "/restauration/equipe", label: "Équipe et paie", icon: <Users size={15} /> },
];

/** Les pages du module Restauration, d'un clic. */
export function RestoNav() {
  const path = usePathname();
  return (
    <nav aria-label="Module restauration" className="flex flex-wrap gap-1.5">
      {LINKS.map(l => {
        const on = path === l.href;
        return (
          <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined}
            className={`h-9 px-3.5 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1.5 ${on ? "bg-ink text-white border-ink" : "border-line text-ink2 hover:bg-surface2"}`}>
            {l.icon} {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
