"use client";
import { useState, useEffect } from "react";
import Link from "next/link"; // Ajout de Link pour la navigation
import { NotificationsBell } from "@/components/shared/NotificationsBell";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";

export function TopBar() {
  const [user, setUser] = useState<{ firstName: string; lastName: string; role: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setUser(d.data?.user || null))
      .catch(() => {});
  }, []);

  return (
    <header className="h-14 bg-white border-b border-clay/30 flex items-center justify-between px-6 flex-shrink-0">
      {/* Barre de recherche */}
      <div className="flex-1">
        <button
          onClick={() => {
            const e = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true });
            document.dispatchEvent(e);
          }}
          className="w-full max-w-md px-4 py-2 text-sm bg-sand rounded-lg border border-clay/30 text-left text-moss hover:border-cedar/50 transition-colors flex items-center justify-between"
        >
          <span>🔍 Rechercher…</span>
          <kbd className="text-xs bg-white px-1.5 py-0.5 rounded border border-clay/30">Ctrl K</kbd>
        </button>
      </div>

      {/* Droite : langue + notifs + profil */}
      <div className="flex items-center gap-3 ml-4">
        <LanguageSwitcher />
        <NotificationsBell />
        
        {mounted && user && (
          <Link 
            href="/associations/profil" 
            className="flex items-center gap-2 hover:bg-sand p-1.5 rounded-xl transition-colors group"
          >
            <div className="w-8 h-8 bg-cedar text-white rounded-full flex items-center justify-center text-sm font-semibold group-hover:ring-2 group-hover:ring-cedar/30 transition-all">
              {user.firstName?.[0]}{user.lastName?.[0]}
            </div>
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-ink leading-none group-hover:text-cedar transition-colors">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-moss capitalize mt-0.5">
                {user.role.replace(/_/g, " ")}
              </p>
            </div>
          </Link>
        )}
      </div>
    </header>
  );
}