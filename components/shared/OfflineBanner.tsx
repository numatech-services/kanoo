"use client";
import { useState, useEffect } from "react";
import { registerServiceWorker, triggerSync, getPendingCount } from "@/lib/offline/sync-queue";

export function OfflineBanner() {
  const [mounted, setMounted] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  useEffect(() => {
    setMounted(true);
    
    // Enregistrer le service worker
    registerServiceWorker();

    // État réseau initial
    setIsOnline(navigator.onLine);

    const handleOnline = async () => {
      setIsOnline(true);
      setSyncing(true);
      await triggerSync();
      setSyncing(false);
      setLastSynced(new Date());
      const count = await getPendingCount();
      setPendingCount(count);
    };

    const handleOffline = () => setIsOnline(false);

    // Écouter sync events du SW
    const handleSynced = async (e: Event) => {
      const { replayed } = (e as CustomEvent).detail;
      if (replayed > 0) {
        setPendingCount(0);
        setLastSynced(new Date());
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("kanoo:synced", handleSynced);

    // Compter les éléments en attente
    getPendingCount().then(setPendingCount);

    // Écouter les réponses bloquées du Service Worker
    const handleFetchError = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.blocked) {
        setBlockedMessage(detail.message);
        setTimeout(() => setBlockedMessage(null), 6000);
      }
    };
    window.addEventListener("kanoo:blocked", handleFetchError);

    return () => {
      window.removeEventListener("kanoo:blocked", handleFetchError);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("kanoo:synced", handleSynced);
    };
  }, []);

  if (!mounted || (isOnline && pendingCount === 0)) return null;

  if (!isOnline) return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-amber-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-medium">
      <span className="animate-pulse">📡</span>
      <div>
        <p>Vous êtes hors-ligne</p>
        {pendingCount > 0 && (
          <p className="text-white/80 text-xs">{pendingCount} action{pendingCount > 1 ? "s" : ""} en attente de synchronisation</p>
        )}
      </div>
    </div>
  );

  if (syncing) return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-blue-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-medium">
      <span className="animate-spin">🔄</span>
      <span>Synchronisation en cours…</span>
    </div>
  );

  if (pendingCount > 0) return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-green-700 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-medium">
      <span>✅</span>
      <span>{pendingCount} action{pendingCount > 1 ? "s" : ""} synchronisée{pendingCount > 1 ? "s" : ""}</span>
    </div>
  );

  return null;
}
