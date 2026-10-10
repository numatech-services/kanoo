import { useEffect, useRef, useState } from "react";

/**
 * Paramètre de l'adresse au premier rendu, pour qu'un raccourci (« Impayés »,
 * « Voir les factures du client »…) ouvre la liste déjà filtrée. Vide côté
 * serveur ; à utiliser dans un initialiseur de `useState`.
 */
export function urlParam(name: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

/**
 * Pour une page rendue aussi côté serveur : applique les paramètres de
 * l'adresse après le montage, puis signale qu'on peut charger (une seule
 * requête, déjà filtrée, et pas d'écart d'hydratation).
 */
export function useUrlReady(apply: (params: URLSearchParams) => void): boolean {
  const [ready, setReady] = useState(false);
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current(new URLSearchParams(window.location.search));
    setReady(true);
  }, []);
  return ready;
}
