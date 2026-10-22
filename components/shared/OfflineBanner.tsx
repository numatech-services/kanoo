"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  registerServiceWorker, triggerSync, getPendingCount, getFailedCount,
  getFailedSyncItems, clearFailedQueue,
  type FailedSyncItem, type SyncResult,
} from "@/lib/offline/sync-queue";

import { AlertTriangle, CheckCircle2, Lock, RefreshCw, WifiOff } from "lucide-react";
/**
 * Bandeau d'état hors-ligne.
 *
 * Il annonçait « N actions synchronisées » en vert à partir de `pendingCount`,
 * qui compte au contraire les actions **encore en attente** : l'utilisateur
 * était rassuré précisément quand il ne fallait pas. Le bandeau rapporte
 * désormais quatre états distincts, dont deux qui n'existaient pas :
 *
 *  - hors ligne, avec le nombre d'écritures mises de côté ;
 *  - synchronisation en cours ;
 *  - **session expirée** — les écritures sont intactes, il faut se reconnecter ;
 *  - **échecs définitifs** — le serveur a refusé, l'utilisateur doit arbitrer.
 */

function labelFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\/api\//, "");
    return path.split("/")[0] || path;
  } catch {
    return url;
  }
}

// État de la connexion, lu sur le navigateur ; « en ligne » au rendu serveur
// et pendant l'hydratation (le bandeau n'apparaît qu'ensuite).
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function OfflineBanner() {
  const isOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [failedItems, setFailedItems] = useState<FailedSyncItem[]>([]);
  const [showFailed, setShowFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [justSynced, setJustSynced] = useState(0);

  // Écrit dans `.then` (après lecture de la file), jamais avant : appelable
  // depuis l'effet de montage sans rendu synchrone supplémentaire.
  const refreshCounts = useCallback(
    () => getPendingCount()
      .then(n => { setPendingCount(n); return getFailedCount(); })
      .then(n => { setFailedCount(n); }),
    [],
  );

  useEffect(() => {
    registerServiceWorker();
    refreshCounts();

    const handleOnline = async () => {
      setSyncing(true);
      await triggerSync();
      setSyncing(false);
      await refreshCounts();
    };

    const handleOffline = () => setNeedsAuth(false);

    // Émis par le service worker à la fin d'un cycle de rejeu.
    const handleSynced = async (event: Event) => {
      const result = (event as CustomEvent<SyncResult>).detail;
      setJustSynced(result?.replayed ?? 0);
      await refreshCounts();
      // Le bandeau de confirmation s'efface seul ; les échecs, non.
      setTimeout(() => setJustSynced(0), 5000);
    };

    const handleNeedsAuth = () => setNeedsAuth(true);

    const handleFailed = async () => {
      setFailedItems(await getFailedSyncItems());
      await refreshCounts();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("kanoo:synced", handleSynced);
    window.addEventListener("kanoo:sync-needs-auth", handleNeedsAuth);
    window.addEventListener("kanoo:sync-failed", handleFailed);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("kanoo:synced", handleSynced);
      window.removeEventListener("kanoo:sync-needs-auth", handleNeedsAuth);
      window.removeEventListener("kanoo:sync-failed", handleFailed);
    };
  }, [refreshCounts]);

  async function openFailed() {
    setFailedItems(await getFailedSyncItems());
    setShowFailed(true);
  }

  async function dismissFailed() {
    await clearFailedQueue();
    setShowFailed(false);
    await refreshCounts();
  }

  // Rendu serveur et hydratation : tous les états valent leur valeur de
  // départ, le bandeau ne s'affiche donc qu'une fois dans le navigateur.
  const shell = "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium max-w-[min(32rem,92vw)]";

  // Les échecs priment : ils demandent une décision et ne disparaissent pas seuls.
  if (failedCount > 0) {
    return (
      <div className={`${shell} bg-neg text-onink`}>
        <div className="flex items-center gap-3">
          <span className="inline-flex" aria-hidden><AlertTriangle size={16} /></span>
          <div className="flex-1">
            <p>
              {failedCount} écriture{failedCount > 1 ? "s" : ""} n&apos;{failedCount > 1 ? "ont" : "a"} pas pu être enregistrée{failedCount > 1 ? "s" : ""}
            </p>
            <p className="text-white/80 text-xs">Le serveur les a refusées. Elles sont conservées, à ressaisir.</p>
          </div>
          <button onClick={() => (showFailed ? setShowFailed(false) : openFailed())}
            className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs whitespace-nowrap">
            {showFailed ? "Masquer" : "Voir"}
          </button>
        </div>

        {showFailed && (
          <div className="mt-3 pt-3 border-t border-white/20 space-y-2 max-h-52 overflow-y-auto">
            {failedItems.map((item, i) => (
              <div key={item.idempotencyKey ?? i} className="text-xs">
                <p className="font-semibold">
                  {item.method} {labelFromUrl(item.url)}
                  <span className="font-normal text-white/70">
                    {" · "}{new Date(item.timestamp).toLocaleString("fr-FR")}
                  </span>
                </p>
                <p className="text-white/80">{item.reason}</p>
              </div>
            ))}
            <button onClick={dismissFailed}
              className="mt-2 px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs">
              J&apos;ai pris note — vider la liste
            </button>
          </div>
        )}
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className={`${shell} bg-warn text-onink flex items-center gap-3`}>
        <span className="inline-flex" aria-hidden><Lock size={16} /></span>
        <div className="flex-1">
          <p>Session expirée pendant la coupure</p>
          <p className="text-white/80 text-xs">
            {pendingCount} écriture{pendingCount > 1 ? "s" : ""} en attente, rien n&apos;est perdu. Reconnectez-vous pour les envoyer.
          </p>
        </div>
        <a href="/login" className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs whitespace-nowrap">
          Se reconnecter
        </a>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className={`${shell} bg-warn text-onink flex items-center gap-3`}>
        <span className="animate-pulse inline-flex" aria-hidden><WifiOff size={16} /></span>
        <div>
          <p>Vous êtes hors-ligne</p>
          {pendingCount > 0 && (
            <p className="text-white/80 text-xs">
              {pendingCount} action{pendingCount > 1 ? "s" : ""} en attente d&apos;envoi
            </p>
          )}
        </div>
      </div>
    );
  }

  if (syncing) {
    return (
      <div className={`${shell} bg-info text-onink flex items-center gap-3`}>
        <span className="animate-spin inline-flex" aria-hidden><RefreshCw size={16} /></span>
        <span>Synchronisation en cours…</span>
      </div>
    );
  }

  // Confirmation : uniquement ce qui est réellement passé.
  if (justSynced > 0) {
    return (
      <div className={`${shell} bg-pos text-onink flex items-center gap-3`}>
        <span className="inline-flex" aria-hidden><CheckCircle2 size={16} /></span>
        <span>
          {justSynced} action{justSynced > 1 ? "s" : ""} synchronisée{justSynced > 1 ? "s" : ""}
        </span>
      </div>
    );
  }

  // En ligne avec une file résiduelle : ne pas prétendre que tout est passé.
  if (pendingCount > 0) {
    return (
      <div className={`${shell} bg-line text-white flex items-center gap-3`}>
        <span aria-hidden>⏳</span>
        <div className="flex-1">
          <p>{pendingCount} action{pendingCount > 1 ? "s" : ""} en attente d&apos;envoi</p>
        </div>
        <button onClick={async () => { setSyncing(true); await triggerSync(); setSyncing(false); await refreshCounts(); }}
          className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs whitespace-nowrap">
          Réessayer
        </button>
      </div>
    );
  }

  return null;
}
