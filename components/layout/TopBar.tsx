"use client";
import { useState, useEffect } from "react";
import Link from "next/link"; // Ajout de Link pour la navigation
import { NotificationsBell } from "@/components/shared/NotificationsBell";
import { Search, CalendarDays, Menu } from "lucide-react";
import { useMe } from "@/lib/useMe";

export function TopBar() {
  const { user } = useMe();
  const [mounted, setMounted] = useState(false);
  // Le libellé du raccourci dépend de la plateforme, et n'est connu qu'après
  // montage : l'afficher côté serveur produirait une divergence d'hydratation.
  const [shortcut, setShortcut] = useState("Ctrl K");
  // La date est calculée après montage : la rendre côté serveur puis client à
  // une seconde d'écart provoquerait une divergence d'hydratation.
  const [today, setToday] = useState("");

  useEffect(() => {
    setMounted(true);
    if (navigator.platform?.toUpperCase().includes("MAC")) setShortcut("⌘ K");
    setToday(new Date().toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
  }, []);

  return (
    <header className="h-14 bg-surface border-b border-line flex items-center justify-between gap-2 px-3 sm:px-6 flex-shrink-0">
      {/* Téléphone et tablette : ouvre le menu en tiroir. */}
      <button type="button" onClick={() => window.dispatchEvent(new Event("kanoo:nav"))}
        className="lg:hidden p-2 -ml-1 rounded-lg text-ink2 hover:bg-surface2" aria-label="Ouvrir le menu">
        <Menu size={20} />
      </button>
      {/* Ouvre la palette de commandes. Ce bouton existait déjà mais ne
          déclenchait rien : aucun composant n'écoutait le raccourci. */}
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
          }}
          className="w-full max-w-md px-3 h-9 text-sm bg-surface2 rounded-lg border border-line text-left text-ink3 hover:border-section transition-colors flex items-center gap-2"
        >
          <Search size={14} className="shrink-0" />
          <span className="flex-1 truncate">Rechercher une facture, un client…</span>
          <kbd className="hidden sm:inline text-[10px] font-mono bg-surface px-1.5 py-0.5 rounded border border-line shrink-0">
            {shortcut}
          </kbd>
        </button>
      </div>

      {/* Droite : date + langue + notifs + profil */}
      <div className="flex items-center gap-2 sm:gap-3 ml-2 sm:ml-4">
        {today && (
          <span className="hidden md:inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-line bg-surface2 text-xs font-medium text-ink2 capitalize">
            <CalendarDays size={14} /> {today}
          </span>
        )}
        {/* Sélecteur de langue retiré : l'interface n'est traduite qu'en français. */}
        <NotificationsBell />
        
        {mounted && user && (
          <Link
            href="/profile"
            className="flex items-center gap-2 hover:bg-surface2 p-1.5 rounded-xl transition-colors group"
          >
            <div className="w-8 h-8 bg-section text-white rounded-full flex items-center justify-center text-sm font-semibold group-hover:ring-2 group-hover:ring-section/30 transition-all">
              {user.firstName?.[0]}{user.lastName?.[0]}
            </div>
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-ink leading-none group-hover:text-section transition-colors">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-ink2 capitalize mt-0.5">
                {user.role?.replace(/_/g, " ")}
              </p>
            </div>
          </Link>
        )}
      </div>
    </header>
  );
}