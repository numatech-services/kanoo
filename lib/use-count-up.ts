"use client";

import { useEffect, useRef, useState } from "react";

/** Valeur posée d'emblée, sans animation (valeur non finie, durée nulle, mouvement réduit). */
function instant(target: number, durationMs: number): boolean {
  if (!Number.isFinite(target) || durationMs <= 0) return true;
  return typeof window !== "undefined"
    && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Comptage progressif d'une valeur.
 *
 * Un montant qui grimpe de zéro à sa valeur donne au regard le temps de s'y
 * poser et signale que le chiffre vient d'être calculé. C'est le seul endroit
 * où l'animation touche une donnée : elle ne modifie jamais la valeur finale,
 * qui est atteinte exactement, et la première image affiche déjà quelque chose
 * de plausible plutôt qu'un zéro trompeur si l'animation est coupée.
 *
 * Respecte `prefers-reduced-motion` : la valeur est alors posée d'emblée.
 */
export function useCountUp(target: number, durationMs = 520): number {
  const [value, setValue] = useState(target);
  const [shown, setShown] = useState(target);
  const frame = useRef<number | undefined>(undefined);
  const previous = useRef(target);

  // Sans animation, la nouvelle valeur est posée pendant le rendu, sans
  // attendre l'effet (motif « ajuster l'état pendant le rendu »).
  if (!Object.is(target, shown)) {
    setShown(target);
    if (instant(target, durationMs)) setValue(target);
  }

  useEffect(() => {
    const from = previous.current;
    previous.current = target;

    if (from === target) return;
    if (instant(target, durationMs)) {
      // Déjà posée au rendu ; reposée à l'image suivante au cas où une image
      // d'une animation précédente serait passée entre-temps.
      frame.current = requestAnimationFrame(() => setValue(target));
      return () => { if (frame.current) cancelAnimationFrame(frame.current); };
    }

    const start = performance.now();
    const delta = target - from;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Décélération : l'essentiel du chemin est parcouru tôt, la fin se pose.
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(progress === 1 ? target : from + delta * eased);
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [target, durationMs]);

  return value;
}
