/**
 * Kanoo — règles du service worker, sans effet de bord : chargées par
 * public/sw.js (importScripts) et testées par Jest (__tests__/unit/sw-policy).
 *
 * Trois principes :
 *  - rien de ce qui touche à l'authentification ou à un fichier envoyé ne
 *    passe par la file hors ligne (un mot de passe n'est jamais stocké, une
 *    déconnexion n'est jamais rejouée plus tard) ;
 *  - aucune donnée connectée n'est mise en cache, sauf quelques listes de
 *    référence, vidées à la connexion et à la déconnexion (téléphone partagé) ;
 *  - une écriture porte sa clé d'idempotence dès le premier essai : si la
 *    réponse se perd, le rejeu est reconnu par le serveur.
 */
(function (root) {
  /** Écritures jamais mises en file : le navigateur les traite normalement. */
  const NETWORK_ONLY_PREFIXES = ["/api/auth/", "/api/client-errors", "/api/cron", "/api/v1/", "/api/webhooks/", "/api/public/", "/api/demo-requests"];

  /** Créations bloquées hors ligne (numérotation légale). */
  const CRITICAL_CREATION_ROUTES = ["/api/invoices", "/api/devis", "/api/contracts", "/api/payslips", "/api/livraisons", "/api/commandes"];

  /** Lectures de référence gardées hors ligne (rafraîchies dès que possible). */
  const CACHEABLE_API_ROUTES = ["/api/clients", "/api/products", "/api/suppliers", "/api/treasury-accounts", "/api/public/plans"];

  /** Caches : le statique (assets, page hors ligne) et les données (vidées à la connexion). */
  const STATIC_CACHE = "kanoo-static-v2";
  const DATA_CACHE = "kanoo-data-v2";
  const META_CACHE = "kanoo-meta";

  /** « /api/auth/ » couvre tout ce qui est dessous ; « /api/clients » couvre /api/clients et /api/clients/… (pas /api/clientsX). */
  function startsWithAny(path, list) {
    return list.some(function (p) {
      return p.charAt(p.length - 1) === "/" ? path.indexOf(p) === 0 : path === p || path.indexOf(p + "/") === 0;
    });
  }

  /**
   * Que faire d'une écriture (POST, PATCH, PUT, DELETE) ?
   *  - "network" : laisser passer, sans file (le navigateur rend l'erreur réseau) ;
   *  - "critical" : envoyer, et refuser hors ligne (pas de numéro légal deviné) ;
   *  - "queue" : envoyer avec une clé d'idempotence, et mettre en file hors ligne.
   */
  function mutationMode(o) {
    const path = o.pathname || "";
    if (path.indexOf("/api/") !== 0) return "network";
    if (startsWithAny(path, NETWORK_ONLY_PREFIXES)) return "network";
    // L'écran gère lui-même son attente (caisse rapide : ticket gardé sur le téléphone).
    if ((o.offlineHeader || "").toLowerCase() === "page") return "network";
    // Un fichier envoyé ne se relit pas en texte : jamais en file.
    if ((o.contentType || "").toLowerCase().indexOf("multipart/form-data") === 0) return "network";
    if (o.method === "POST" && CRITICAL_CREATION_ROUTES.some(function (r) { return path === r || path === r + "/"; })) return "critical";
    return "queue";
  }

  /**
   * Que faire d'une lecture (GET) ?
   *  - "static" : assets versionnés, cache d'abord ;
   *  - "swr" : liste de référence, cache puis réseau ;
   *  - "page" : navigation, réseau seulement (page hors ligne en secours) ;
   *  - "network" : tout le reste, sans cache (données connectées, flux RSC).
   */
  function readMode(o) {
    const path = o.pathname || "";
    if (o.sameOrigin === false) return "network";
    if (path.indexOf("/_next/static/") === 0 || path.indexOf("/icons/") === 0 || path === "/manifest.json") return "static";
    if (path.indexOf("/api/") === 0) return startsWithAny(path, CACHEABLE_API_ROUTES) ? "swr" : "network";
    if (o.isRsc) return "network";
    if (o.isNavigate) return "page";
    return "network";
  }

  /**
   * Rejeu d'une écriture en file, selon la réponse du serveur :
   * "done" (2xx), "auth" (session à rouvrir), "retry" (passager, ou requête
   * identique encore en cours : 409 « en cours »), "failed" (refus définitif).
   */
  function replayDecision(status, errorText) {
    if (status >= 200 && status < 300) return "done";
    if (status === 401 || status === 403) return "auth";
    if (status === 408 || status === 429 || status >= 500) return "retry";
    if (status === 409 && /en cours/i.test(errorText || "")) return "retry";
    return "failed";
  }

  const api = {
    NETWORK_ONLY_PREFIXES: NETWORK_ONLY_PREFIXES, CRITICAL_CREATION_ROUTES: CRITICAL_CREATION_ROUTES, CACHEABLE_API_ROUTES: CACHEABLE_API_ROUTES,
    STATIC_CACHE: STATIC_CACHE, DATA_CACHE: DATA_CACHE, META_CACHE: META_CACHE,
    mutationMode: mutationMode, readMode: readMode, replayDecision: replayDecision,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KanooSwPolicy = api;
})(typeof self !== "undefined" ? self : this);
