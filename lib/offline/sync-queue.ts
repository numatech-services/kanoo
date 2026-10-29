/**
 * Client-side interface pour la sync queue hors-ligne
 * Utilisé dans les composants React pour afficher l'état de sync
 */

"use client";

import { purgeDrafts } from "@/lib/use-draft";

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

/**
 * Les magasins, comme le service worker les crée (public/sw.js openDB). Sans
 * eux, une lecture faite avant le premier passage du service worker créait la
 * base VIDE à cette version : le service worker n'avait plus d'occasion de les
 * créer et la file hors ligne échouait.
 */
function createStores(e: IDBVersionChangeEvent) {
  const db = (e.target as IDBOpenDBRequest).result;
  if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
  if (!db.objectStoreNames.contains(FAILED_STORE)) db.createObjectStore(FAILED_STORE, { keyPath: "id", autoIncrement: true });
}

function readStore<T>(store: string): Promise<T[]> {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve([]);

  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = createStores;
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

/** Caches des données (public/sw-policy.js DATA_CACHE / META_CACHE). */
const DATA_CACHE = "kanoo-data-v2";
const META_CACHE = "kanoo-meta";

async function tellWorker(message: Record<string, unknown>) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  (navigator.serviceWorker.controller ?? reg?.active)?.postMessage(message);
}

/**
 * Efface les données gardées hors ligne : « data » à l'ouverture de la page de
 * connexion (rien de la session précédente ne reste lisible), « all » à la
 * déconnexion volontaire (la file des écritures aussi : elle ne doit pas
 * partir sous la session de quelqu'un d'autre). Faite par la page elle-même
 * ET par le service worker : l'un ou l'autre peut manquer.
 */
export async function purgeOfflineData(scope: "data" | "all"): Promise<void> {
  if (typeof window === "undefined") return;
  // Brouillons des formulaires (lib/use-draft) : effacés à la déconnexion volontaire.
  if (scope === "all") purgeDrafts();
  try { await caches?.delete(DATA_CACHE); if (scope === "all") await caches?.delete(META_CACHE); } catch { /* Cache Storage indisponible */ }
  if (scope === "all" && window.indexedDB) {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = createStores;
      req.onsuccess = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const tx = db.transaction([QUEUE_STORE, FAILED_STORE], "readwrite");
        tx.objectStore(QUEUE_STORE).clear();
        tx.objectStore(FAILED_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
  await tellWorker({ type: scope === "all" ? "PURGE_ALL" : "PURGE_DATA" });
}

/** L'utilisateur connecté : la file hors ligne d'un autre utilisateur n'est jamais rejouée sous sa session. */
export function setOfflineOwner(owner: string): Promise<void> {
  // Brouillons d'un autre utilisateur de ce téléphone : effacés.
  purgeDrafts(owner);
  return tellWorker({ type: "SET_OWNER", owner: owner.trim().toLowerCase() });
}
