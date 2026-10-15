"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { NotificationsBell } from "@/components/shared/NotificationsBell";
import { Search, CalendarDays, Menu } from "lucide-react";
import { useMe } from "@/lib/useMe";

/**
 * Barre du haut (charte v5) : recherche en pilule, date, notifications. Sur
 * grand écran, l'utilisateur et la déconnexion sont en pied du menu latéral ;
 * sur téléphone, l'avatar reste ici.
 */
export function TopBar() {
  const { user } = useMe();
  const [mounted, setMounted] = useState(false);
  // Le libellé du raccourci dépend de la plateforme, et n'est connu qu'après
  // montage : l'afficher côté serveur produirait une divergence d'hydratation.
  const [shortcut, setShortcut] = useState("Ctrl K");
  // La date est calculée après montage, pour la même raison.
  const [today, setToday] = useState("");

  useEffect(() => {
    setMounted(true);
    if (navigator.platform?.toUpperCase().includes("MAC")) setShortcut("⌘ K");
    setToday(new Date().toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
  }, []);

  return (
    <header className="flex items-center gap-2.5 px-4 sm:px-7 pt-4 lg:pt-5 pb-2 flex-shrink-0">
      {/* Téléphone et tablette : ouvre le menu en tiroir. */}
      <button type="button" onClick={() => window.dispatchEvent(new Event("kanoo:nav"))}
        className="lg:hidden icon-pill" aria-label="Ouvrir le menu">
        <Menu size={19} />
      </button>
      {/* Ouvre la palette de commandes (⌘K). */}
      <button
        type="button"
        onClick={() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })); }}
        className="flex-1 min-w-0 max-w-[480px] h-[46px] pl-4 pr-3 rounded-full bg-surface border border-line text-left text-ink3 hover:border-accent/40 transition-colors flex items-center gap-2.5 text-sm"
      >
        <Search size={17} className="shrink-0 opacity-70" />
        <span className="flex-1 truncate">Rechercher une facture, un client…</span>
        <kbd className="hidden sm:inline text-[10px] font-mono bg-surface2 px-1.5 py-0.5 rounded-md border border-line shrink-0">{shortcut}</kbd>
      </button>
      <div className="flex-1" />
      {today && (
        <span className="hidden md:inline-flex items-center gap-2 h-[46px] px-4 rounded-full border border-line bg-surface text-[13.5px] font-medium text-ink capitalize shrink-0">
          <CalendarDays size={16} className="opacity-60" /> {today}
        </span>
      )}
      <NotificationsBell />
      {mounted && user && (
        <Link href="/profile" aria-label="Mon profil"
          className="lg:hidden w-[46px] h-[46px] rounded-full grid place-items-center text-sm font-bold text-white bg-gradient-to-br from-[rgb(234_153_82)] to-[rgb(225_75_57)] shrink-0">
          {user.firstName?.[0]}{user.lastName?.[0]}
        </Link>
      )}
    </header>
  );
}
