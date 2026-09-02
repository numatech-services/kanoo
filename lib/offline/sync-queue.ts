/**
 * Client-side interface pour la sync queue hors-ligne
 * Utilisé dans les composants React pour afficher l'état de sync
 */

"use client";

const SYNC_TAG = "kanoo-sync";

export interface SyncQueueItem {
  id: number;
  url: string;
  method: string;
  body?: string;
  idempotencyKey?: string;
  attempts?: number;
  timestamp: number;
}

/** Écriture définitivement refusée par le serveur, en attente d'arbitrage. */
export interface FailedSyncItem extends SyncQueueItem {
  reason: string;
  failedAt: number;
}

/** Bilan d'un cycle de rejeu, tel que le service worker le rapporte. */
export interface SyncResult {
  replayed: number;
  pending: number;
  failed: number;
  needsAuth: boolean;
  total: number;
}

const DB_NAME = "kanoo-offline";
const DB_VERSION = 2;
const QUEUE_STORE = "sync-queue";
const FAILED_STORE = "sync-failed";

/**
 * Enregistre le service worker et configure la sync
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });

    // Écouter les messages de sync du SW
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "SYNC_RESULT") {
        const result = event.data as SyncResult;

        // La session a expiré pendant la coupure : les écritures sont toujours
        // en file, il suffit de rouvrir une session puis de relancer.
        if (result.needsAuth) {
          window.dispatchEvent(new CustomEvent("kanoo:sync-needs-auth", { detail: result }));
        }

        // Un échec définitif est signalé même si des écritures sont passées :
        // l'utilisateur doit savoir ce qui n'a pas été enregistré.
        if (result.failed > 0) {
          window.dispatchEvent(new CustomEvent("kanoo:sync-failed", { detail: result }));
        }

        if (result.replayed > 0) {
          window.dispatchEvent(new CustomEvent("kanoo:synced", { detail: result }));
        }
      }
    });

    // Écouter la reconnexion pour déclencher la sync
    window.addEventListener("online", () => {
      triggerSync(registration);
    });

    return registration;
  } catch (err) {
    console.warn("[SW] Enregistrement échoué:", err);
    return null;
  }
}

/**
 * Déclenche la synchronisation (Background Sync ou fallback message)
 */
export async function triggerSync(registration?: ServiceWorkerRegistration): Promise<void> {
  const reg = registration || (await navigator.serviceWorker.ready);
  
  // Essayer Background Sync API (Chrome/Edge)
  if ("sync" in reg) {
    try {
      await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(SYNC_TAG);
      return;
    } catch { /* Fallback */ }
  }

  // Fallback : message direct au SW
  const sw = reg.active || reg.waiting || reg.installing;
  sw?.postMessage({ type: "REPLAY_QUEUE" });
}

function readStore<T>(store: string): Promise<T[]> {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve([]);

  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(store)) { resolve([]); return; }
      const tx = db.transaction(store, "readonly");
      const getAll = tx.objectStore(store).getAll();
      getAll.onsuccess = () => resolve(getAll.result as T[]);
      getAll.onerror = () => resolve([]);
    };
    req.onerror = () => resolve([]);
    // La base est à une version antérieure et une autre page la bloque : plutôt
    // que d'attendre indéfiniment, on répond vide.
    req.onblocked = () => resolve([]);
  });
}

/** Écritures encore en attente de rejeu. */
export function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  return readStore<SyncQueueItem>(QUEUE_STORE);
}

/** Écritures refusées par le serveur, à corriger ou à abandonner. */
export function getFailedSyncItems(): Promise<FailedSyncItem[]> {
  return readStore<FailedSyncItem>(FAILED_STORE);
}

/** Compte les éléments en attente. */
export async function getPendingCount(): Promise<number> {
  return (await getPendingSyncItems()).length;
}

/** Compte les échecs non arbitrés — à afficher tant qu'il en reste. */
export async function getFailedCount(): Promise<number> {
  return (await getFailedSyncItems()).length;
}

function clearStore(store: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(store)) { resolve(); return; }
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    };
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/**
 * Vide la file d'attente. Action destructrice : à ne proposer qu'après avoir
 * montré à l'utilisateur ce qu'elle contient.
 */
export function clearSyncQueue(): Promise<void> {
  return clearStore(QUEUE_STORE);
}

/** Abandonne les écritures en échec, une fois qu'elles ont été arbitrées. */
export function clearFailedQueue(): Promise<void> {
  return clearStore(FAILED_STORE);
}
