"use client";

import { useId } from "react";
import { linearScale, smoothPath, areaPath, type Point } from "./geometry";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Marquer le dernier point — il porte la valeur courante. */
  showEndpoint?: boolean;
  filled?: boolean;
  className?: string;
}

/**
 * Micro-courbe destinée à vivre dans une carte d'indicateur ou une cellule de
 * tableau. Pas d'axe, pas d'infobulle : elle donne la forme du mouvement, le
 * chiffre exact étant juste à côté.
 */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  color = "rgb(var(--s-accent))",
  showEndpoint = true,
  filled = true,
  className = "",
}: SparklineProps) {
  const gradientId = useId();
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) {
    // Un seul point ne décrit aucune tendance : mieux vaut ne rien tracer.
    return <div className={className} style={{ width, height }} aria-hidden />;
  }

  const pad = 3;
  const scale = linearScale(finite, height - pad, pad, false);
  const points: Point[] = finite.map((v, i) => ({
    x: pad + (i / (finite.length - 1)) * (width - pad * 2),
    y: scale.to(v),
  }));
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {filled && <path d={areaPath(points, height - pad)} fill={`url(#${gradientId})`} />}
      <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round" />
      {showEndpoint && (
        <circle cx={last.x} cy={last.y} r="2.5" fill={color} />
      )}
    </svg>
  );
}
