/**
 * Kanoo — Service Worker
 *
 * Les règles (quoi mettre en cache, quoi mettre en file) sont dans
 * /sw-policy.js, testé sans navigateur. Ici, leur exécution :
 *  - assets versionnés : cache d'abord ;
 *  - quelques listes de référence (clients, articles…) : cache puis réseau ;
 *  - pages et autres données : réseau seulement, page hors ligne en secours
 *    (rien de connecté n'est gardé : un téléphone se partage) ;
 *  - écritures : envoyées avec leur clé d'idempotence, mises en file hors
 *    ligne et rejouées à la reconnexion — jamais l'authentification ni un
 *    fichier envoyé.
 *
 * Messages reçus de l'application : PURGE_DATA (connexion : données en cache
 * effacées), PURGE_ALL (déconnexion : données et file effacées), SET_OWNER
 * (utilisateur connecté : la file d'un autre utilisateur est abandonnée, elle
 * ne doit pas partir sous sa session), REPLAY_QUEUE, GET_FAILED, SKIP_WAITING.
 */
importScripts("/sw-policy.js");
const P = self.KanooSwPolicy;

const SYNC_TAG = "kanoo-sync";
const OFFLINE_FALLBACK = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(P.STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_FALLBACK]).catch(() => {}))
  );
  self.skipWaiting();
});

// Les anciens caches partent, dont « kanoo-v1 » qui gardait des pages et des
// réponses connectées.
self.addEventListener("activate", (event) => {
  const keep = [P.STATIC_CACHE, P.DATA_CACHE, P.META_CACHE];
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" && request.method !== "HEAD") {
    const mode = P.mutationMode({
      pathname: url.pathname, method: request.method,
      contentType: request.headers.get("content-type"), offlineHeader: request.headers.get("x-kanoo-offline"),
    });
    // « network » : pas de respondWith, le navigateur traite la requête normalement.
    if (mode !== "network") event.respondWith(handleMutation(request, mode));
    return;
  }

  const mode = P.readMode({
    pathname: url.pathname, sameOrigin: url.origin === self.location.origin,
    isNavigate: request.mode === "navigate", isRsc: request.headers.get("rsc") === "1" || url.searchParams.has("_rsc"),
  });
  if (mode === "static") event.respondWith(cacheFirst(request));
  else if (mode === "swr") event.respondWith(staleWhileRevalidate(request));
  else if (mode === "page") event.respondWith(pageOrOffline(request));
  // « network » : pas de respondWith, rien n'est mis en cache.
});

// ─────────────────────────────────────────────────────────────────────────────
// STRATÉGIES
// ─────────────────────────────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(P.STATIC_CACHE)).put(request, response.clone());
    return response;
  } catch {
    return new Response("Ressource non disponible hors-ligne", { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(P.DATA_CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  if (cached) return cached;
  return (await fresh) || offlineFallbackJson();
}

/** Navigation : le réseau, sinon la page hors ligne. La page elle-même n'est jamais gardée. */
async function pageOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(OFFLINE_FALLBACK)) || offlineHtmlResponse();
  }
}

/**
 * Écriture : la clé d'idempotence est posée AVANT le premier envoi. Si le
 * serveur a traité la requête mais que la réponse s'est perdue, le rejeu
 * porte la même clé et le serveur rend la réponse d'origine au lieu de créer
 * un doublon.
 */
async function handleMutation(request, mode) {
  const key = request.headers.get("idempotency-key") || newIdempotencyKey();
  const body = await request.clone().text().catch(() => null);
  const headers = new Headers(request.headers);
  headers.set("Idempotency-Key", key);
  try {
    return await fetch(request.url, { method: request.method, headers, body, credentials: "include" });
  } catch {
    if (mode === "critical") {
      return new Response(
        JSON.stringify({
          success: false, offline: true, blocked: true,
          error: "Vous êtes hors-ligne. La création de ce document nécessite une connexion internet pour garantir la numérotation et éviter les doublons. Reconnectez-vous et réessayez.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
    await queueMutation(request, body, key);
    return new Response(
      JSON.stringify({ success: true, offline: true, queued: true, message: "Action enregistrée hors-ligne — elle sera synchronisée à la reconnexion" }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPRIÉTAIRE DE LA FILE, PURGE
// ─────────────────────────────────────────────────────────────────────────────

const OWNER_KEY = "/__kanoo_owner";

async function readOwner() {
  const r = await (await caches.open(P.META_CACHE)).match(OWNER_KEY);
  return r ? r.text() : "";
}

/** Un autre utilisateur se connecte : la file du précédent est abandonnée (elle partirait sous la nouvelle session). */
async function setOwner(owner) {
  const previous = await readOwner();
  if (previous && owner && previous !== owner) await clearQueues();
  await (await caches.open(P.META_CACHE)).put(OWNER_KEY, new Response(owner || ""));
}

async function purge(all) {
  await caches.delete(P.DATA_CACHE);
  if (all) {
    await clearQueues();
    await caches.delete(P.META_CACHE);
  }
}

async function clearQueues() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, FAILED_STORE], "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(FAILED_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE DES MUTATIONS HORS-LIGNE (IndexedDB)
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = "kanoo-offline";
const STORE_NAME = "sync-queue";
// Les écritures définitivement refusées par le serveur atterrissent ici plutôt
// que d'être supprimées : une facture rejetée doit rester visible et reprenable.
const FAILED_STORE = "sync-failed";
const DB_VERSION = 2;

// Au-delà, on cesse de réessayer : le serveur refuse pour une raison qui ne
// disparaîtra pas toute seule.
const MAX_ATTEMPTS = 5;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(FAILED_STORE)) {
        db.createObjectStore(FAILED_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clé d'idempotence : identifie l'INTENTION de l'utilisateur, pas la tentative.
 * Elle est générée une seule fois, à la mise en file, et rejouée à l'identique
 * — c'est ce qui permet au serveur de reconnaître un rejeu et de renvoyer la
 * réponse d'origine au lieu de créer un second document.
 */
function newIdempotencyKey() {
  if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID();
  const bytes = self.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function queueMutation(request, body, key) {
  const db = await openDB();
  const headers = Object.fromEntries(request.headers.entries());

  // Les en-têtes d'authentification ne sont pas conservés : le jeton aurait
  // expiré au moment du rejeu. Le cookie de session, lui, part tout seul.
  delete headers["authorization"];
  delete headers["cookie"];

  const entry = {
    url: request.url,
    method: request.method,
    headers,
    body,
    idempotencyKey: key,
    attempts: 0,
    timestamp: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Réécrit une entrée en place (compteur de tentatives, dernière erreur). */
async function updateQueued(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Déplace une entrée vers le magasin des échecs, sans jamais la perdre. */
async function moveToFailed(item, reason) {
  const db = await openDB();
  const { id, ...rest } = item;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(FAILED_STORE, "readwrite");
    tx.objectStore(FAILED_STORE).add({ ...rest, reason, failedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await deleteQueued(id);
}

/** Écritures en échec définitif, à présenter à l'utilisateur. */
async function getFailed() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FAILED_STORE, "readonly");
    const req = tx.objectStore(FAILED_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
    // Une seule exécution, dont on garde la promesse : la lancer deux fois
    // rejouerait chaque écriture en double.
    const run = replayQueue().then((result) => {
      event.source?.postMessage({ type: "SYNC_COMPLETE", ...result });
    });
    event.waitUntil?.(run);
  }
  if (event.data?.type === "GET_FAILED") {
    getFailed().then((items) => {
      event.source?.postMessage({ type: "FAILED_ITEMS", items });
    });
  }
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "PURGE_DATA" || event.data?.type === "PURGE_ALL") {
    const run = purge(event.data.type === "PURGE_ALL").then(() => event.source?.postMessage({ type: "PURGED" }));
    event.waitUntil?.(run);
  }
  if (event.data?.type === "SET_OWNER") {
    event.waitUntil?.(setOwner(String(event.data.owner || "")));
  }
});

/**
 * Rejoue la file à la reconnexion.
 *
 * Une seule règle gouverne la suppression : **seul un 2xx efface une écriture**.
 * L'ancienne condition (`status < 500`) supprimait aussi les 400, 401, 403 et
 * 409 en les comptant comme des succès — une facture saisie hors ligne et
 * rejouée après expiration du jeton (401) disparaissait en silence, avec une
 * notification de synchronisation réussie.
 *
 * Les autres cas :
 *  - 401/403 : la session a expiré pendant la coupure. On garde l'écriture et
 *    on demande à l'application de rafraîchir la session, sans consommer de
 *    tentative — l'utilisateur n'y est pour rien.
 *  - 408/429/5xx : incident passager, on réessaiera au prochain déclenchement.
 *  - autres 4xx : refus définitif (validation). L'écriture part dans le
 *    magasin des échecs pour être présentée et corrigée.
 */
async function replayQueue() {
  const queue = await getAllQueued();
  if (!queue.length) return { replayed: 0, pending: 0, failed: 0, needsAuth: false };

  let replayed = 0;
  let pending = 0;
  let failed = 0;
  let needsAuth = false;

  for (const item of queue) {
    let response;
    try {
      response = await fetch(item.url, {
        method: item.method,
        headers: {
          ...item.headers,
          "x-offline-sync": "true",
          // Rejouée à l'identique à chaque tentative : c'est ce qui rend le
          // rejeu sûr même si le serveur avait déjà traité la requête.
          "Idempotency-Key": item.idempotencyKey,
        },
        body: item.method !== "GET" && item.method !== "HEAD" ? item.body : undefined,
        credentials: "include",
      });
    } catch {
      // Toujours hors ligne : on ne consomme pas de tentative.
      pending++;
      continue;
    }

    let detail = "";
    if (response.status >= 400) {
      try { detail = (await response.clone().json())?.error || ""; } catch { /* corps non JSON */ }
    }
    const decision = P.replayDecision(response.status, detail);
    if (decision === "done") {
      await deleteQueued(item.id);
      replayed++;
      continue;
    }
    if (decision === "auth") {
      needsAuth = true;
      pending++;
      continue;
    }
    if (decision === "retry") {
      item.attempts = (item.attempts || 0) + 1;
      item.lastStatus = response.status;
      if (item.attempts >= MAX_ATTEMPTS) {
        await moveToFailed(item, `Le serveur a répondu ${response.status} après ${item.attempts} tentatives.`);
        failed++;
      } else {
        await updateQueued(item);
        pending++;
      }
      continue;
    }
    // Refus définitif : réessayer n'y changera rien, mais l'écriture ne doit pas disparaître.
    await moveToFailed(item, detail || `Refusée par le serveur (${response.status}).`);
    failed++;
  }

  const result = { replayed, pending, failed, needsAuth, total: queue.length };

  // Notifier les clients ouverts
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: "SYNC_RESULT", ...result });
  }
  return result;
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
