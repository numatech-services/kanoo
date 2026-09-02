"use client";

import { useState } from "react";
import { fullXof } from "./geometry";

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  /** Libellé au centre. Le total est calculé, jamais fourni de l'extérieur. */
  centerLabel?: string;
  formatValue?: (v: number) => string;
  emptyMessage?: string;
}

/** Palette de repli, dérivée de l'accent de section par variation d'opacité. */
const FALLBACK_OPACITY = [1, 0.78, 0.58, 0.42, 0.3, 0.22];

/**
 * Anneau de répartition. Le total au centre est la somme des parts affichées —
 * il ne peut donc pas contredire le graphique.
 */
export function DonutChart({
  slices,
  size = 180,
  thickness = 26,
  centerLabel = "Total",
  formatValue = fullXof,
  emptyMessage = "Aucune donnée",
}: DonutChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const positive = slices.filter(s => Number.isFinite(s.value) && s.value > 0);
  const total = positive.reduce((sum, s) => sum + s.value, 0);

  if (total <= 0) {
    return (
      <div className="flex items-center justify-center text-sm text-ink3" style={{ height: size }}>
        {emptyMessage}
      </div>
    );
  }

  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
          aria-label={`Répartition : ${positive.map(s => s.label).join(", ")}`}>
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            {positive.map((slice, i) => {
              const fraction = slice.value / total;
              const dash = fraction * circumference;
              const color = slice.color || "rgb(var(--s-accent))";
              const el = (
                <circle key={slice.label} cx={cx} cy={cy} r={r}
                  fill="none" stroke={color}
                  strokeOpacity={slice.color ? 1 : FALLBACK_OPACITY[i % FALLBACK_OPACITY.length]}
                  strokeWidth={hover === i ? thickness + 4 : thickness}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ transition: "stroke-width 120ms" }} />
              );
              offset += dash;
              return el;
            })}
          </g>
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
          <p className="text-[10px] uppercase tracking-wider text-ink3">
            {hover === null ? centerLabel : positive[hover].label}
          </p>
          <p className="text-base font-bold text-ink num leading-tight">
            {formatValue(hover === null ? total : positive[hover].value)}
          </p>
          {hover !== null && (
            <p className="text-[11px] text-ink2 num">
              {Math.round((positive[hover].value / total) * 100)}&nbsp;%
            </p>
          )}
        </div>
      </div>

      <ul className="flex-1 space-y-2 w-full min-w-0">
        {positive.map((slice, i) => (
          <li key={slice.label}
            className="flex items-center gap-2 text-sm cursor-default"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{
                background: slice.color || "rgb(var(--s-accent))",
                opacity: slice.color ? 1 : FALLBACK_OPACITY[i % FALLBACK_OPACITY.length],
              }} />
            <span className="text-ink2 truncate">{slice.label}</span>
            <span className="ml-auto num font-semibold text-ink shrink-0">
              {Math.round((slice.value / total) * 100)}&nbsp;%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
