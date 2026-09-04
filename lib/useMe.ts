"use client";

import { useEffect, useState } from "react";

export interface MeUser { firstName?: string; lastName?: string; role?: string; email?: string; phone?: string; }
export interface MeTenant { name?: string; logo?: string; type?: "pme" | "association" | "administration"; primaryColor?: string; }
export interface Me { user: MeUser | null; tenant: MeTenant | null; }

// Cache au niveau module : /api/auth/me n'est lu qu'une fois par chargement,
// même si plusieurs composants (barre latérale, en-tête, coque) en ont besoin.
let cache: Me | null = null;
let inflight: Promise<Me> | null = null;

function fetchMe(): Promise<Me> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        cache = { user: d.data?.user ?? null, tenant: d.data?.tenant ?? null };
        return cache;
      })
      .catch(() => ({ user: null, tenant: null }))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Vide le cache — à appeler après une modification du profil ou de l'organisation. */
export function invalidateMe() { cache = null; }

export function useMe(): Me & { loading: boolean } {
  const [me, setMe] = useState<Me>(cache ?? { user: null, tenant: null });
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    fetchMe().then((m) => { if (alive) { setMe(m); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  return { ...me, loading };
}
