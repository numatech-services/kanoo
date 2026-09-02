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
  timestamp: number;
}

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
        const { replayed, failed } = event.data;
        if (replayed > 0) {
          window.dispatchEvent(new CustomEvent("kanoo:synced", {
            detail: { replayed, failed },
          }));
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

/**
 * Récupère les éléments en attente de sync depuis IndexedDB
 */
export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  if (typeof window === "undefined" || !window.indexedDB) return [];

  return new Promise((resolve) => {
    const req = indexedDB.open("kanoo-offline", 1);
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("sync-queue")) {
        resolve([]);
        return;
      }
      const tx = db.transaction("sync-queue", "readonly");
      const store = tx.objectStore("sync-queue");
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => resolve(getAllReq.result as SyncQueueItem[]);
      getAllReq.onerror = () => resolve([]);
    };
    req.onerror = () => resolve([]);
  });
}

/**
 * Compte les éléments en attente
 */
export async function getPendingCount(): Promise<number> {
  const items = await getPendingSyncItems();
  return items.length;
}

/**
 * Vide manuellement la queue (en cas de conflit)
 */
export async function clearSyncQueue(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open("kanoo-offline", 1);
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("sync-queue")) { resolve(); return; }
      const tx = db.transaction("sync-queue", "readwrite");
      tx.objectStore("sync-queue").clear();
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => resolve();
  });
}
