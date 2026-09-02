"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "kanoo_cookie_consent";
type Choice = { necessary: true; analytics: boolean; marketing: boolean; ts: string };

export function CookieConsent() {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setOpen(true); } catch { /* stockage indispo */ }
  }, []);

  function save(a: boolean, m: boolean) {
    const choice: Choice = { necessary: true, analytics: a, marketing: m, ts: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* ignore */ }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
      <div className="max-w-3xl mx-auto bg-surface border border-line2 rounded-xl shadow-soft p-5">
        <h2 className="font-display font-semibold text-ink text-lg">Votre vie privée</h2>
        <p className="text-sm text-ink2 mt-1">
          Nous utilisons des cookies nécessaires au fonctionnement du site. Avec votre accord, nous ajoutons la mesure d'audience et le marketing.{" "}
          <Link href="/confidentialite" className="text-accent-700 font-medium hover:underline">En savoir plus</Link>.
        </p>

        {custom && (
          <div className="mt-4 space-y-2.5">
            <label className="flex items-center gap-3 text-sm opacity-70">
              <input type="checkbox" checked readOnly className="w-4 h-4 accent-accent" />
              <span><b className="font-semibold">Nécessaires</b> — indispensables (toujours actifs)</span>
            </label>
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="w-4 h-4 accent-accent" />
              <span><b className="font-semibold">Mesure d'audience</b> — statistiques de visite anonymisées</span>
            </label>
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="w-4 h-4 accent-accent" />
              <span><b className="font-semibold">Marketing</b> — personnalisation et campagnes</span>
            </label>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-5">
          {/* Refuser aussi visible qu'Accepter (pas de dark pattern). */}
          <button onClick={() => save(false, false)} className="btn-secondary flex-1 sm:flex-none">Tout refuser</button>
          {custom ? (
            <button onClick={() => save(analytics, marketing)} className="btn-secondary flex-1 sm:flex-none">Enregistrer mes choix</button>
          ) : (
            <button onClick={() => setCustom(true)} className="btn-secondary flex-1 sm:flex-none">Personnaliser</button>
          )}
          <button onClick={() => save(true, true)} className="btn-primary flex-1 sm:flex-none">Tout accepter</button>
        </div>
      </div>
    </div>
  );
}
