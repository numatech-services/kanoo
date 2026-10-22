import { useState, useSyncExternalStore } from "react";

/**
 * Paramètre de l'adresse au premier rendu, pour qu'un raccourci (« Impayés »,
 * « Voir les factures du client »…) ouvre la liste déjà filtrée. Vide côté
 * serveur ; à utiliser dans un initialiseur de `useState`.
 */
export function urlParam(name: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

// Aucun abonnement : l'instantané ne sert qu'à distinguer le rendu serveur
// (et l'hydratation) du rendu dans le navigateur.
const noSubscribe = () => () => {};

/**
 * Pour une page rendue aussi côté serveur : applique les paramètres de
 * l'adresse une fois l'hydratation passée, puis signale qu'on peut charger
 * (une seule requête, déjà filtrée, et pas d'écart d'hydratation).
 *
 * `apply` est appelée pendant le rendu (motif « ajuster l'état pendant le
 * rendu ») : elle ne doit modifier que l'état du composant qui appelle ce hook.
 */
export function useUrlReady(apply: (params: URLSearchParams) => void): boolean {
  const [ready, setReady] = useState(false);
  // Faux au rendu serveur et pendant l'hydratation, vrai ensuite.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (inBrowser && !ready) {
    setReady(true);
    apply(new URLSearchParams(window.location.search));
  }
  return ready;
}
