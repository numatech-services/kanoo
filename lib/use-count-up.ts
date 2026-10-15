"use client";

import { useEffect, useRef, useState } from "react";

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
  const frame = useRef<number | undefined>(undefined);
  const previous = useRef(target);

  useEffect(() => {
    const from = previous.current;
    previous.current = target;

    if (!Number.isFinite(target)) { setValue(target); return; }
    if (from === target) return;

    const reduced = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || durationMs <= 0) { setValue(target); return; }

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
