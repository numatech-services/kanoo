/**
 * Utilitaires pour les requêtes offline-aware
 * Remplace fetch() dans les composants pour gérer automatiquement le mode hors-ligne
 */

"use client";

export type OfflineStatus = "online" | "offline" | "syncing";

/**
 * Fetch offline-aware : retourne les données du cache si hors-ligne
 * Émet des événements pour notifier l'UI du statut
 */
export async function offlineFetch(
  url: string,
  options?: RequestInit,
  opts?: {
    cacheKey?: string;
    ttl?: number; // secondes
  }
): Promise<{ data: unknown; fromCache: boolean; offline: boolean }> {
  const cacheKey = opts?.cacheKey || url;
  const ttl = (opts?.ttl || 300) * 1000; // défaut 5 minutes

  // Essayer le réseau
  try {
    const response = await fetch(url, options);
    const data = await response.json();

    // Mettre en cache si succès
    if (response.ok && typeof window !== "undefined") {
      sessionStorage.setItem(
        `cache:${cacheKey}`,
        JSON.stringify({ data, ts: Date.now() })
      );
    }

    return { data, fromCache: false, offline: false };
  } catch {
    // Hors-ligne : chercher dans le cache
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem(`cache:${cacheKey}`);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        const isStale = Date.now() - ts > ttl;
        return { data, fromCache: true, offline: true };
      }
    }

    return {
      data: { success: false, offline: true, data: null },
      fromCache: false,
      offline: true,
    };
  }
}

/**
 * Hook pour détecter le statut réseau
 */
export function getNetworkStatus(): "online" | "offline" {
  if (typeof window === "undefined") return "online";
  return navigator.onLine ? "online" : "offline";
}

/**
 * Pré-cache les données critiques au démarrage
 * À appeler depuis le dashboard après login
 */
export async function preCacheCriticalData(): Promise<void> {
  const criticalEndpoints = [
    { url: "/api/clients?limit=100&isActive=true", key: "clients-list" },
    { url: "/api/products?limit=100&isActive=true", key: "products-list" },
    { url: "/api/treasury-accounts", key: "treasury-accounts" },
    { url: "/api/employees?isActive=true&limit=100", key: "employees-list" },
  ];

  await Promise.allSettled(
    criticalEndpoints.map(({ url, key }) =>
      offlineFetch(url, { credentials: "include" }, { cacheKey: key, ttl: 600 })
    )
  );
}
