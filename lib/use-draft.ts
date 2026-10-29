"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMe } from "@/lib/useMe";

/**
 * Brouillon d'un formulaire, gardé sur l'appareil : une facture en cours de
 * saisie survit à une déconnexion pour inactivité, à un rechargement, à un
 * passage par WhatsApp ou l'appli de mobile money.
 *
 * Rattaché à l'utilisateur (son adresse) : un autre utilisateur du même
 * téléphone ne le voit jamais, et il est effacé à la déconnexion volontaire
 * (lib/offline/sync-queue purgeOfflineData) et quand un autre utilisateur se
 * connecte (purgeDrafts). Gardé 7 jours au plus.
 */
export const DRAFT_PREFIX = "kanoo.draft.";
const MAX_AGE_MS = 7 * 86_400_000;

interface Stored<T> { v: T; at: number }

const storageKey = (owner: string, key: string) => `${DRAFT_PREFIX}${owner.trim().toLowerCase()}.${key}`;

/** Le brouillon brut, s'il a moins de 7 jours (lu hors rendu, par le store externe). */
function read(k: string | null): string | null {
  if (!k) return null;
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    return Date.now() - (JSON.parse(raw) as Stored<unknown>).at < MAX_AGE_MS ? raw : null;
  } catch { return null; }
}

/** Efface les brouillons : tous, ou ceux qui ne sont pas à `keepOwner`. */
export function purgeDrafts(keepOwner?: string) {
  try {
    const keep = keepOwner ? `${DRAFT_PREFIX}${keepOwner.trim().toLowerCase()}.` : null;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(DRAFT_PREFIX) && (!keep || !k.startsWith(keep))) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
  } catch { /* stockage indisponible */ }
}

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const notify = () => listeners.forEach(l => l());

/**
 * `key` : nom du formulaire (« invoice-new »), ou null pour ne rien garder
 * (modification d'un document existant). Rend le brouillon trouvé à
 * l'ouverture (`pending`), à reprendre ou à ignorer ; tant qu'il n'est pas
 * tranché, rien n'est écrasé. `clear()` après un enregistrement réussi.
 */
export function useFormDraft<T>(key: string | null, value: T) {
  const { user } = useMe();
  const owner = user?.email ?? "";
  const k = key && owner ? storageKey(owner, key) : null;
  const raw = useSyncExternalStore(subscribe, () => read(k), () => null);
  const [decided, setDecided] = useState(false);

  const pending = useMemo(() => {
    if (!raw || decided) return null;
    try { return JSON.parse(raw) as Stored<T>; } catch { return null; }
  }, [raw, decided]);

  const serialized = JSON.stringify(value);
  const [initial] = useState(serialized);

  // Enregistrement (après une pause de saisie), seulement une fois le brouillon
  // précédent tranché, et seulement si le formulaire a changé depuis l'ouverture.
  useEffect(() => {
    if (!k || pending || serialized === initial) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(k, JSON.stringify({ v: JSON.parse(serialized), at: Date.now() })); } catch { /* plein */ }
    }, 800);
    return () => clearTimeout(t);
  }, [k, serialized, pending, initial]);

  const discard = useCallback(() => {
    setDecided(true);
    if (k) { try { localStorage.removeItem(k); } catch { /* indisponible */ } }
    notify();
  }, [k]);
  const restore = useCallback((): T | null => {
    setDecided(true);
    const v = pending?.v ?? null;
    notify();
    return v;
  }, [pending]);
  const clear = useCallback(() => {
    setDecided(true);
    if (k) { try { localStorage.removeItem(k); } catch { /* indisponible */ } }
    notify();
  }, [k]);

  return { pending: pending ? { savedAt: pending.at } : null, restore, discard, clear };
}
