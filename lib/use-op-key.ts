"use client";
import { useRef } from "react";

/**
 * Clé d'opération d'un formulaire : gardée tant que l'envoi n'a pas réussi.
 * Un clic répété après une coupure réseau rejoue la même opération, le serveur
 * la reconnaît et ne la double pas.
 */
export function useOpKey() {
  const k = useRef("");
  return {
    headers: () => { k.current ||= crypto.randomUUID(); return { "Idempotency-Key": k.current }; },
    done: () => { k.current = ""; },
  };
}
