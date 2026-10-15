"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { rolesCanPerform, effectiveRoles } from "@/lib/role-resources";
import type { UserRole } from "@/types";

export interface MeUser {
  firstName?: string; lastName?: string; role?: string; email?: string; phone?: string;
  roles?: string[]; roleLevels?: Record<string, string>; allowedResources?: string[];
}
export interface MeTenant { name?: string; logo?: string; type?: "pme" | "association" | "administration"; primaryColor?: string; disabledModules?: string[]; }
export interface Me { user: MeUser | null; tenant: MeTenant | null; resources: string[]; }

// Cache au niveau module : /api/auth/me n'est lu qu'une fois par chargement,
// même si plusieurs composants (barre latérale, en-tête, coque) en ont besoin.
let cache: Me | null = null;
let inflight: Promise<Me> | null = null;
/** Cache périmé (invalidateMe) : encore affiché, mais relu au prochain appel. */
let stale = false;
const EMPTY: Me = { user: null, tenant: null, resources: [] };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

function fetchMe(): Promise<Me> {
  if (cache && !stale) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/auth/me", { credentials: "include" })
      // Un refus (session expirée…) n'est pas mis en cache comme « aucun droit » :
      // la lecture suivante réessaie.
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => {
        const m: Me = { user: d.data?.user ?? null, tenant: d.data?.tenant ?? null, resources: d.data?.resources ?? [] };
        cache = m; stale = false; listeners.forEach(l => l());
        return m;
      })
      .catch(() => ({ user: null, tenant: null, resources: [] }))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** L'utilisateur a-t-il accès à une ressource ? (« * » = tout, pour superadmin) */
export function meCan(resources: string[], resource: string): boolean {
  return resources.includes("*") || resources.includes(resource);
}

/**
 * L'utilisateur peut-il faire `action` sur `resource` ? Même calcul que le
 * serveur (rôles cumulés, niveau chef / employé / stagiaire) : sert à masquer
 * un bouton que l'API refuserait — ex. « Supprimer » pour un employé.
 * Le serveur reste seul juge ; ceci n'est que de l'affichage.
 */
export function meCanDo(me: Pick<Me, "user">, resource: string, action: "create" | "read" | "update" | "delete"): boolean {
  const u = me.user;
  if (!u?.role) return false;
  if (u.role === "superadmin") return true;
  const roles = effectiveRoles(u.role as UserRole, u.roles as UserRole[] | undefined);
  return rolesCanPerform(roles, resource, action, u.allowedResources, u.roleLevels as never);
}

/** Relit le profil — à appeler après une modification du profil ou de l'organisation. */
export function invalidateMe() {
  // L'ancien profil reste affiché le temps de la relecture, puis tous les
  // composants abonnés (en-tête, barre latérale…) reçoivent le nouveau.
  stale = true;
  void fetchMe();
}

/**
 * Profil de l'utilisateur connecté. Pendant l'hydratation, l'instantané est
 * toujours vide, comme au rendu serveur : un écran sous <Suspense> s'hydrate
 * après la coque, qui a souvent déjà rempli le cache — partir du cache
 * affichait alors des boutons absents du HTML serveur (erreur React #418).
 * React rend aussitôt après avec le cache.
 */
export function useMe(): Me & { loading: boolean } {
  const me = useSyncExternalStore(subscribe, () => cache ?? EMPTY, () => EMPTY);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMe().then(() => { if (alive) setSettled(true); });
    return () => { alive = false; };
  }, []);

  return { ...me, loading: me === EMPTY && !settled };
}
