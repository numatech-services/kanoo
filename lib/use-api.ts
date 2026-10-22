"use client";
import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api-client";

/** Réponse d'API (enveloppe `{ success, data, error }`), telle que la renvoie `apiJson`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- même type que la réponse JSON, lue ensuite par `select`
export type ApiBody = any;

export interface ApiResource<T> {
  /** Données sélectionnées ; la valeur initiale tant que rien n'est arrivé. */
  data: T;
  /** Une lecture est en cours pour l'adresse demandée (premier chargement ou rechargement). */
  loading: boolean;
  /** Message d'erreur du serveur, ou null. L'erreur est déjà signalée à l'écran par `apiJson`. */
  error: string | null;
  /** La réponse est arrivée au moins une fois pour une adresse (utile pour distinguer « vide » de « pas encore chargé »). */
  loaded: boolean;
  /** Relit l'adresse (après une création, une suppression…). */
  reload: () => void;
}

interface Snapshot { key: string; body: ApiBody }

/**
 * Lecture d'une adresse d'API par un écran — le chargement commun de
 * l'application.
 *
 * Avant : chaque écran écrivait son `useState` + `useEffect` + `setLoading`
 * (111 variantes), avec deux défauts récurrents — un `setLoading(true)`
 * synchrone dans l'effet (rendu supplémentaire, signalé par le compilateur
 * React) et aucune protection contre une réponse lente qui arrive après une
 * plus récente (filtre changé deux fois de suite : l'écran affichait le
 * résultat du premier filtre).
 *
 * Ici : la réponse brute est conservée avec l'adresse qui l'a produite ;
 * `loading` se DÉDUIT (l'adresse demandée n'a pas encore de réponse), la
 * sélection se fait au rendu, et une requête devenue inutile est annulée.
 *
 * @param url     Adresse à lire ; `null` = rien à lire (données initiales, pas de chargement).
 * @param select  Extrait la valeur utile de la réponse (ex. `b => b.data?.items ?? []`).
 *                Appelée au rendu : pour un calcul coûteux, mémoïser côté écran.
 * @param initial Valeur tant que rien n'est arrivé (et si `url` est null).
 */
export function useApi<T>(
  url: string | null,
  select: (body: ApiBody) => T,
  initial: T,
  opts: { quiet?: boolean } = {},
): ApiResource<T> {
  const [nonce, setNonce] = useState(0);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  // Dernière réponse réussie : un rechargement raté garde l'écran tel qu'il
  // était (comme le faisaient les chargements écrits à la main), l'erreur
  // étant exposée à part.
  const [good, setGood] = useState<Snapshot | null>(null);
  const key = url === null ? null : `${nonce}|${url}`;
  const { quiet } = opts;

  useEffect(() => {
    if (key === null || url === null) return;
    const ctrl = new AbortController();
    apiJson(url, { quiet, signal: ctrl.signal })
      .then(body => {
        if (ctrl.signal.aborted) return;
        setSnap({ key, body });
        if (body?.success !== false) setGood({ key, body });
      })
      .catch(() => { /* requête annulée : une plus récente a pris le relais */ });
    return () => ctrl.abort();
  }, [key, url, quiet]);

  const reload = useCallback(() => setNonce(n => n + 1), []);
  const current = snap && key !== null && snap.key === key ? snap : null;
  // Pendant un rechargement, on garde la dernière réponse affichée plutôt que
  // de vider l'écran ; `loading` dit qu'une lecture est en cours. Après un
  // échec, la dernière réponse réussie reste affichée s'il y en a une.
  const failed = current?.body?.success === false;
  const body = failed ? (good?.body ?? current!.body) : current?.body ?? good?.body ?? snap?.body;
  return {
    data: url === null || body === undefined ? initial : select(body),
    loading: key !== null && !current,
    error: current?.body?.success === false ? String(current.body.error ?? "Lecture impossible.") : null,
    loaded: body !== undefined,
    reload,
  };
}
