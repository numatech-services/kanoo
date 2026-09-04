"use client";
import { useState, useEffect } from "react";
import Link from "next/link"; // Ajout de Link pour la navigation
import { NotificationsBell } from "@/components/shared/NotificationsBell";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { Search } from "lucide-react";
import { useMe } from "@/lib/useMe";

export function TopBar() {
  const { user } = useMe();
  const [mounted, setMounted] = useState(false);
  // Le libellé du raccourci dépend de la plateforme, et n'est connu qu'après
  // montage : l'afficher côté serveur produirait une divergence d'hydratation.
  const [shortcut, setShortcut] = useState("Ctrl K");

  useEffect(() => {
    setMounted(true);
    if (navigator.platform?.toUpperCase().includes("MAC")) setShortcut("⌘ K");
  }, []);

  return (
    <header className="h-14 bg-surface border-b border-line flex items-center justify-between px-6 flex-shrink-0">
      {/* Ouvre la palette de commandes. Ce bouton existait déjà mais ne
          déclenchait rien : aucun composant n'écoutait le raccourci. */}
      <div className="flex-1">
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
          }}
          className="w-full max-w-md px-3 h-9 text-sm bg-surface2 rounded-lg border border-line text-left text-ink3 hover:border-section transition-colors flex items-center gap-2"
        >
          <Search size={14} className="shrink-0" />
          <span className="flex-1">Aller à…</span>
          <kbd className="text-[10px] font-mono bg-surface px-1.5 py-0.5 rounded border border-line shrink-0">
            {shortcut}
          </kbd>
        </button>
      </div>

      {/* Droite : langue + notifs + profil */}
      <div className="flex items-center gap-3 ml-4">
        <LanguageSwitcher />
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