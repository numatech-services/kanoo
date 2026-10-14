"use client";

import { useEffect, useRef, useState } from "react";

import { buttonClass } from "@/components/ui/button-class";
/**
 * Déconnexion automatique après une période d'inactivité.
 *
 * La session (JWT) dure 8 h ; sans garde d'inactivité, un poste laissé ouvert
 * reste connecté tout ce temps. Ce composant, monté dans la coque authentifiée,
 * déconnecte l'utilisateur après `IDLE_MINUTES` sans interaction, avec un
 * avertissement `WARN_SECONDS` avant. L'activité et la déconnexion sont
 * synchronisées entre les onglets via `localStorage` : bouger la souris dans un
 * onglet réarme tous les autres, et se déconnecter dans un onglet déconnecte
 * les autres.
 *
 * Ce garde est côté client (confort et sécurité d'un poste partagé). La borne
 * dure reste l'expiration du jeton côté serveur.
 */
const IDLE_MINUTES = Number(process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES || "3");
const WARN_SECONDS = 60;
const IDLE_MS = Math.max(60_000, IDLE_MINUTES * 60_000);
const ACTIVITY_KEY = "kanoo.lastActivity";
const LOGOUT_KEY = "kanoo.loggedOut";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"];

function now() { return Date.now(); }
function readLast(): number {
  try { return Number(localStorage.getItem(ACTIVITY_KEY)) || now(); } catch { return now(); }
}
function writeLast(ts: number) { try { localStorage.setItem(ACTIVITY_KEY, String(ts)); } catch { /* stockage indisponible */ } }

export function IdleTimeout() {
  const [remaining, setRemaining] = useState<number | null>(null); // secondes avant déconnexion, si avertissement affiché
  const loggingOut = useRef(false);

  useEffect(() => {
    writeLast(now());

    // Battement : prolonge la session glissante côté serveur. Appelé au montage
    // puis sur activité réelle (throttlé 60 s) — surtout pas sur les requêtes de
    // fond, sinon le sondage des notifications ferait passer un poste inactif
    // pour actif.
    let lastPing = 0;
    function ping() {
      lastPing = now();
      fetch("/api/auth/ping", { method: "POST", credentials: "include" }).catch(() => {});
    }
    ping();

    async function logout(reason: "idle" | "peer") {
      if (loggingOut.current) return;
      loggingOut.current = true;
      try {
        if (reason === "idle") localStorage.setItem(LOGOUT_KEY, String(now()));
      } catch { /* ignore */ }
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch { /* on redirige quand même */ }
      window.location.href = reason === "idle" ? "/login?reason=idle" : "/login";
    }

    // Activité : réarme le minuteur (écriture throttlée à 5 s pour ne pas marteler
    // localStorage à chaque pixel de souris).
    let lastWrite = 0;
    function onActivity() {
      const t = now();
      // Écriture throttlée (5 s). Le battement local (toutes les 2 s) relit
      // l'horodatage et masque l'avertissement dès que l'inactivité repasse
      // sous le seuil.
      if (t - lastWrite > 5_000) { writeLast(t); lastWrite = t; }
      // Ping serveur throttlé (60 s) : prolonge la session glissante.
      if (t - lastPing > 60_000) ping();
    }

    // Un autre onglet s'est déconnecté → on suit.
    function onStorage(e: StorageEvent) {
      if (e.key === LOGOUT_KEY && e.newValue) logout("peer");
    }

    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    window.addEventListener("storage", onStorage);

    // Battement : vérifie l'inactivité toutes les 2 s en lisant l'horodatage
    // partagé (donc l'activité dans n'importe quel onglet compte).
    const tick = setInterval(() => {
      const idle = now() - readLast();
      if (idle >= IDLE_MS) { logout("idle"); return; }
      const left = Math.ceil((IDLE_MS - idle) / 1000);
      setRemaining(left <= WARN_SECONDS ? left : null);
    }, 2_000);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      window.removeEventListener("storage", onStorage);
      clearInterval(tick);
    };
    // Volontairement sans dépendances : le minuteur vit toute la session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stayConnected() {
    writeLast(now());
    // Prolonge aussi la session côté serveur, sans attendre le prochain geste.
    fetch("/api/auth/ping", { method: "POST", credentials: "include" }).catch(() => {});
    setRemaining(null);
  }

  if (remaining === null) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="w-full max-w-sm rounded-2xl bg-surface border border-line shadow-xl p-6 text-center space-y-4">
        <h2 id="idle-title" className="text-lg font-bold text-ink">Toujours là ?</h2>
        <p className="text-sm text-ink2">
          Par sécurité, votre session va se fermer pour inactivité dans{" "}
          <span className="font-bold text-ink tabular-nums">{remaining}</span> seconde{remaining > 1 ? "s" : ""}.
        </p>
        <button onClick={stayConnected}
          className={buttonClass("primary", "md", "w-full")}>
          Rester connecté
        </button>
      </div>
    </div>
  );
}
