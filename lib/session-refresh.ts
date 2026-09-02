/**
 * Gestion de session côté client : déconnexion réelle après inactivité.
 *
 * Avant : le token était rafraîchi toutes les 20 min SANS CONDITION, ce qui
 * remettait son `iat` à zéro en permanence — la session ne mourait donc jamais
 * tant qu'un onglet restait ouvert, même sans aucune activité (bug signalé).
 *
 * Maintenant : on suit l'activité réelle (souris, clavier, tactile, scroll).
 *  - Inactif ≥ 30 min  → déconnexion (logout + redirection login).
 *  - Actif             → le token est prolongé au plus toutes les 15 min.
 * Le contrôle serveur (âge du token dans /api/auth/refresh) reste la source de
 * vérité : défense en profondeur.
 */
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 min sans activité → déconnexion
const CHECK_INTERVAL_MS = 60 * 1000;        // vérification chaque minute
const REFRESH_AFTER_MS = 15 * 60 * 1000;    // prolonger le token au plus toutes les 15 min

export function useSessionRefresh() {
  const router = useRouter();
  const lastActivity = useRef<number>(Date.now());
  const lastRefresh = useRef<number>(Date.now());
  const endedRef = useRef<boolean>(false);

  useEffect(() => {
    const markActivity = () => { lastActivity.current = Date.now(); };
    const events: Array<keyof WindowEventMap> = [
      "mousemove", "mousedown", "keydown", "scroll", "touchstart", "click",
    ];
    events.forEach((e) => window.addEventListener(e, markActivity, { passive: true }));

    function redirectToLogin(msg: string) {
      if (endedRef.current) return;
      endedRef.current = true;
      router.push(`/login?expired=1&msg=${encodeURIComponent(msg)}`);
    }

    async function logoutForInactivity() {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch {
        // Hors-ligne : on redirige tout de même ; le cookie sera nettoyé au retour.
      }
      redirectToLogin("Votre session a expiré pour inactivité.");
    }

    async function refresh() {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
        if (res.ok) { lastRefresh.current = Date.now(); return; }
        const data = await res.json().catch(() => ({}));
        const code = (data as { code?: string }).code;
        if (code === "SESSION_REVOKED") {
          redirectToLogin("Votre session a été révoquée par un administrateur.");
        } else {
          redirectToLogin("Votre session a expiré.");
        }
      } catch {
        // Réseau indisponible : on réessaiera au prochain tick.
      }
    }

    const interval = setInterval(() => {
      if (endedRef.current) return;
      const now = Date.now();
      if (now - lastActivity.current >= INACTIVITY_LIMIT_MS) {
        logoutForInactivity();
        return;
      }
      // Utilisateur actif : prolonger la session, mais pas à chaque tick.
      if (now - lastRefresh.current >= REFRESH_AFTER_MS) {
        refresh();
      }
    }, CHECK_INTERVAL_MS);

    // Au retour sur l'onglet : si l'inactivité a dépassé la limite, déconnecter.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivity.current >= INACTIVITY_LIMIT_MS) logoutForInactivity();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      events.forEach((e) => window.removeEventListener(e, markActivity));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
}
