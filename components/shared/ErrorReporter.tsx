"use client";
import { useEffect } from "react";

/** Au plus quelques rapports par page : une boucle d'erreurs ne doit pas inonder le journal. */
const MAX_PER_PAGE = 8;
let sent = 0;
const seen = new Set<string>();

/** Envoie un rapport au journal des erreurs (sans attendre, survit à la fermeture de la page). */
export function reportClientError(r: { kind?: "client" | "csp"; message: string; stack?: string; digest?: string }) {
  try {
    const key = `${r.kind ?? "client"}|${r.message}`;
    if (sent >= MAX_PER_PAGE || seen.has(key)) return;
    seen.add(key); sent++;
    const body = JSON.stringify({ ...r, url: location.pathname });
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/client-errors", blob)) {
      void fetch("/api/client-errors", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => undefined);
    }
  } catch { /* le rapport d'erreur ne doit jamais en provoquer une */ }
}

/** Erreurs d'extensions et de scripts tiers : hors de notre portée, pas dans le journal. */
const foreign = (src?: string) => Boolean(src && /^(chrome|moz|safari)-extension:|^webkit-masked-url:/.test(src));

/**
 * Écoute, sur toutes les pages : erreurs JavaScript non rattrapées, promesses
 * rejetées sans gestionnaire, violations de la Content-Security-Policy (un
 * script bloqué par le nonce est une régression à voir, pas un bruit).
 */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (foreign(e.filename)) return;
      reportClientError({ message: e.message || "Erreur JavaScript", stack: e.error?.stack });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | undefined;
      // Enregistrement du service worker refusé par le navigateur : connu, sans effet sur l'application.
      if (/service ?worker|fetching the script/i.test(r?.message ?? "")) return;
      reportClientError({ message: `Promesse rejetée : ${r?.message ?? String(e.reason)}`, stack: r?.stack });
    };
    const onCsp = (e: SecurityPolicyViolationEvent) => {
      if (foreign(e.sourceFile) || foreign(e.blockedURI)) return;
      reportClientError({ kind: "csp", message: `CSP ${e.effectiveDirective} a bloqué ${e.blockedURI || "un script en ligne"}`, stack: e.sourceFile ? `${e.sourceFile}:${e.lineNumber}` : undefined });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("securitypolicyviolation", onCsp);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("securitypolicyviolation", onCsp);
    };
  }, []);
  return null;
}
