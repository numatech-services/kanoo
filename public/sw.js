/**
 * Kanoo — Service Worker
 * Stratégie :
 *  - Pages/assets : Cache First (avec fallback réseau)
 *  - API GET listes : Stale-While-Revalidate (données fraîches dès que réseau disponible)
 *  - API mutations (POST/PATCH/DELETE) hors-ligne : Background Sync Queue
 */

const CACHE_VERSION = "kanoo-v1";
const SYNC_TAG = "kanoo-sync";

// ─── Ressources à précacher au premier chargement ─────────────────────────────
const PRECACHE_URLS = [
  "/dashboard",
  "/clients",
  "/invoices",
  "/offline",
];

// ─── Routes API à mettre en cache (GET uniquement) ────────────────────────────
const CACHEABLE_API_ROUTES = [
  "/api/clients",
  "/api/invoices",
  "/api/products",
  "/api/suppliers",
  "/api/employees",
  "/api/treasury-accounts",
  "/api/public/plans",
];

const OFFLINE_FALLBACK = "/offline";

// ─────────────────────────────────────────────────────────────────────────────
// INSTALL — précacher les ressources essentielles
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => {
        // Ignorer les erreurs de précache (pages protégées redirigent vers /login)
      })
    )
  );
  self.skipWaiting();
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE — nettoyer les anciens caches
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─────────────────────────────────────────────────────────────────────────────
// FETCH — intercepter les requêtes
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET vers l'API → elles passent par la sync queue
  if (request.method !== "GET" && url.pathname.startsWith("/api/")) {
    event.respondWith(handleOfflineMutation(request));
    return;
  }

  // API GET → Stale-While-Revalidate
  const isApiGet = request.method === "GET" && 
    CACHEABLE_API_ROUTES.some(r => url.pathname.startsWith(r));
  
  if (isApiGet) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Assets statiques → Cache First
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js")
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Pages HTML → Network First avec fallback cache
  event.respondWith(networkFirstWithFallback(request));
});

// ─────────────────────────────────────────────────────────────────────────────
// STRATÉGIES DE CACHE
// ─────────────────────────────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Ressource non disponible hors-ligne", { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  // Lancer la mise à jour en arrière-plan
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  // Retourner le cache immédiatement si disponible, sinon attendre le réseau
  return cached || fetchPromise || offlineFallbackJson();
}

async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback page hors-ligne pour les navigations
    if (request.mode === "navigate") {
      return caches.match(OFFLINE_FALLBACK) || offlineHtmlResponse();
    }
    return offlineFallbackJson();
  }
}

// Routes critiques dont la CRÉATION (POST) est bloquée hors-ligne
// pour éviter les doublons lors du replay
const CRITICAL_CREATION_ROUTES = [
  "/api/invoices",
  "/api/devis",
  "/api/contracts",
  "/api/payslips",
  "/api/livraisons",
  "/api/commandes",
];

function isCriticalCreation(request) {
  if (request.method !== "POST") return false;
  const url = new URL(request.url);
  return CRITICAL_CREATION_ROUTES.some(r => url.pathname === r || url.pathname === r + "/");
}

async function handleOfflineMutation(request) {
  try {
    // Essayer le réseau en premier
    return await fetch(request.clone());
  } catch {
    // Hors-ligne — vérifier si c'est une création critique
    if (isCriticalCreation(request)) {
      return new Response(
        JSON.stringify({
          success: false,
          offline: true,
          blocked: true,
          message: "⚠ Vous êtes hors-ligne. La création de ce document nécessite une connexion internet pour garantir la numérotation et éviter les doublons. Reconnectez-vous et réessayez.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
    // Pour les autres mutations (mises à jour, suppressions) : empiler dans la queue
    await queueMutation(request);
    return new Response(
      JSON.stringify({
        success: true,
        offline: true,
        message: "Action enregistrée hors-ligne — sera synchronisée à la reconnexion",
      }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE DES MUTATIONS HORS-LIGNE (IndexedDB)
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = "kanoo-offline";
const STORE_NAME = "sync-queue";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueMutation(request) {
  const db = await openDB();
  const body = await request.clone().text().catch(() => null);
  const entry = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    timestamp: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllQueued() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteQueued(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND SYNC — rejouer les mutations à la reconnexion
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayQueue());
  }
});

// Fallback si Background Sync API non supportée : écouter "online"
self.addEventListener("message", (event) => {
  if (event.data?.type === "REPLAY_QUEUE") {
    replayQueue().then(() => {
      event.source?.postMessage({ type: "SYNC_COMPLETE" });
    });
  }
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function replayQueue() {
  const queue = await getAllQueued();
  if (!queue.length) return;

  let replayed = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: { ...item.headers, "x-offline-sync": "true" },
        body: item.method !== "GET" && item.method !== "HEAD" ? item.body : undefined,
      });
      if (response.ok || response.status < 500) {
        await deleteQueued(item.id);
        replayed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  // Notifier les clients ouverts
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({
      type: "SYNC_RESULT",
      replayed,
      failed,
      total: queue.length,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function offlineFallbackJson() {
  return new Response(
    JSON.stringify({ success: false, error: "Hors-ligne", offline: true }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}

function offlineHtmlResponse() {
  return new Response(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Hors-ligne — Kanoo</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#F3F1EA;margin:0}
    .box{text-align:center;padding:2rem}.icon{font-size:4rem}.title{font-size:1.5rem;font-weight:600;color:#0B1020;margin:1rem 0}
    .msg{color:#6B705C;max-width:300px}.btn{margin-top:1.5rem;padding:.75rem 1.5rem;background:#2F3E46;color:#fff;border:none;border-radius:.75rem;cursor:pointer;font-size:.9rem}
    </style></head><body>
    <div class="box"><div class="icon">📡</div>
    <div class="title">Connexion perdue</div>
    <div class="msg">Vous êtes hors-ligne. Vos actions seront synchronisées automatiquement à la reconnexion.</div>
    <button class="btn" onclick="location.reload()">Réessayer</button></div>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
