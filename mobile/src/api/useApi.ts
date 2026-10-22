import { useCallback, useEffect, useState } from "react";
import { api } from "./client";

/**
 * Lecture d'une adresse d'API par un écran (même principe que lib/use-api.ts
 * côté web) : la réponse est rangée avec l'adresse qui l'a produite, `loading`
 * s'en déduit, une réponse devenue obsolète est ignorée.
 */
export function useApi<T>(path: string | null) {
  const [nonce, setNonce] = useState(0);
  const [snap, setSnap] = useState<{ key: string; data: T | null; error?: string } | null>(null);
  const key = path === null ? null : `${nonce}|${path}`;

  useEffect(() => {
    if (key === null || path === null) return;
    let live = true;
    api<T>("GET", path).then(r => { if (live) setSnap({ key, data: r.data, error: r.ok ? undefined : r.error }); });
    return () => { live = false; };
  }, [key, path]);

  const reload = useCallback(() => setNonce(n => n + 1), []);
  const current = snap && snap.key === key ? snap : null;
  return { data: (current ?? snap)?.data ?? null, error: current?.error, loading: key !== null && !current, reload };
}
