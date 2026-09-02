"use client";

import { useState } from "react";
import { linearScale, niceTicks, compactXof, fullXof } from "./geometry";

export interface BarSerie {
  label: string;
  values: number[];
  color?: string;
}

interface BarChartProps {
  labels: string[];
  series: BarSerie[];
  height?: number;
  /** Empiler plutôt que juxtaposer — utile pour une décomposition d'un total. */
  stacked?: boolean;
  formatValue?: (v: number) => string;
  emptyMessage?: string;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 46 };

/**
 * Barres arrondies, juxtaposées ou empilées.
 *
 * Les valeurs négatives sont dessinées sous la ligne de zéro plutôt qu'ignorées :
 * un mois à marge négative doit se voir.
 */
export function BarChart({
  labels,
  series,
  height = 220,
  stacked = false,
  formatValue = fullXof,
  emptyMessage = "Aucune donnée sur la période",
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const hasData = series.some(s => s.values.some(v => Number.isFinite(v) && v !== 0));
  if (!labels.length || !hasData) {
    return (
      <div className="flex items-center justify-center text-sm text-ink3" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }

  const W = 640;
  const H = height;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // En empilé, l'échelle porte sur les cumuls, pas sur les valeurs unitaires.
  const domain = stacked
    ? labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] || 0), 0))
    : series.flatMap(s => s.values);

  const scale = linearScale(domain, PAD.top + innerH, PAD.top);
  const ticks = niceTicks(scale.min, scale.max, 4);
  const zero = scale.to(0);

  const slot = innerW / labels.length;
  const groupW = slot * 0.62;
  const barW = stacked ? groupW : groupW / series.length;
  const radius = Math.min(6, barW / 2);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img"
        aria-label={`Répartition : ${series.map(s => s.label).join(", ")}`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={scale.to(t)} y2={scale.to(t)}
              stroke="rgb(var(--c-line))" strokeWidth="1"
              strokeDasharray={t === 0 ? undefined : "3 3"} />
            <text x={PAD.left - 8} y={scale.to(t)} textAnchor="end" dominantBaseline="middle"
              className="fill-ink3" style={{ fontSize: 10 }}>
              {compactXof(t)}
            </text>
          </g>
        ))}

        {labels.map((label, i) => {
          const groupX = PAD.left + i * slot + (slot - groupW) / 2;
          let stackTop = zero;
          let stackBottom = zero;

          return (
            <g key={label}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH}
                fill={hover === i ? "rgb(var(--s-soft))" : "transparent"} opacity="0.5" />

              {series.map((s, j) => {
                const value = s.values[i] || 0;
                const color = s.color || "rgb(var(--s-accent))";
                let y: number, h: number, x: number;

                if (stacked) {
                  x = groupX;
                  const size = Math.abs(scale.to(value) - zero);
                  if (value >= 0) { y = stackTop - size; stackTop -= size; }
                  else { y = stackBottom; stackBottom += size; }
                  h = size;
                } else {
                  x = groupX + j * barW;
                  const v = scale.to(value);
                  y = Math.min(v, zero);
                  h = Math.abs(v - zero);
                }

                if (h < 0.5) return null;
                return (
                  <rect key={s.label} x={x + (stacked ? 0 : 1)} y={y}
                    width={stacked ? barW : Math.max(1, barW - 2)} height={h}
                    rx={radius} fill={color}
                    opacity={hover === null || hover === i ? 1 : 0.45} />
                );
              })}
            </g>
          );
        })}

        {labels.map((label, i) => (
          <text key={i} x={PAD.left + i * slot + slot / 2} y={H - 8} textAnchor="middle"
            className="fill-ink3" style={{ fontSize: 10 }}>
            {label}
          </text>
        ))}
      </svg>

      {hover !== null && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 bg-surface border border-line rounded-lg shadow-soft px-3 py-2 text-xs z-10">
          <p className="font-semibold text-ink">{labels[hover]}</p>
          {series.map(s => (
            <p key={s.label} className="flex items-center gap-2 text-ink2 mt-1">
              <span className="h-2 w-2 rounded-full shrink-0"
                style={{ background: s.color || "rgb(var(--s-accent))" }} />
              <span>{s.label}</span>
              <span className="num font-semibold text-ink ml-auto">{formatValue(s.values[hover] ?? 0)}</span>
            </p>
          ))}
        </div>
      )}

      {series.length > 1 && (
        <div className="flex flex-wrap gap-4 mt-3 justify-center">
          {series.map(s => (
            <span key={s.label} className="flex items-center gap-2 text-xs text-ink2">
              <span className="h-2 w-2 rounded-full"
                style={{ background: s.color || "rgb(var(--s-accent))" }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
