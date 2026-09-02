"use client";

import { useId, useState } from "react";
import { linearScale, smoothPath, areaPath, niceTicks, compactXof, fullXof, type Point } from "./geometry";

export interface Serie {
  label: string;
  values: number[];
  /** Couleur CSS. Par défaut, l'accent de la section courante. */
  color?: string;
}

interface AreaChartProps {
  labels: string[];
  series: Serie[];
  height?: number;
  /** Remplir sous la courbe. Désactivé au-delà d'une série pour rester lisible. */
  filled?: boolean;
  formatValue?: (v: number) => string;
  emptyMessage?: string;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 46 };

/**
 * Courbe lissée avec aire, graduations rondes et survol point par point.
 *
 * Le composant refuse de dessiner une série vide : afficher un cadre gradué
 * sans donnée laisse croire à une mesure à zéro, alors qu'il n'y a rien à
 * mesurer. Un message explicite vaut mieux qu'un graphique muet.
 */
export function AreaChart({
  labels,
  series,
  height = 220,
  filled,
  formatValue = fullXof,
  emptyMessage = "Aucune donnée sur la période",
}: AreaChartProps) {
  const gradientId = useId();
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

  const all = series.flatMap(s => s.values);
  const scale = linearScale(all, PAD.top + innerH, PAD.top);
  const ticks = niceTicks(scale.min, scale.max, 4);

  const xAt = (i: number) =>
    PAD.left + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);

  const shouldFill = filled ?? series.length === 1;
  // Un libellé sur n pour que l'axe reste lisible quand la série est longue.
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img"
        aria-label={`Évolution : ${series.map(s => s.label).join(", ")}`}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color || "rgb(var(--s-accent))"} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color || "rgb(var(--s-accent))"} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* Grille horizontale et graduations */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={scale.to(t)} y2={scale.to(t)}
              stroke="rgb(var(--c-line))" strokeWidth="1" />
            <text x={PAD.left - 8} y={scale.to(t)} textAnchor="end" dominantBaseline="middle"
              className="fill-ink3" style={{ fontSize: 10 }}>
              {compactXof(t)}
            </text>
          </g>
        ))}

        {series.map((s, i) => {
          const points: Point[] = s.values.map((v, j) => ({ x: xAt(j), y: scale.to(v) }));
          const color = s.color || "rgb(var(--s-accent))";
          return (
            <g key={s.label}>
              {shouldFill && (
                <path d={areaPath(points, PAD.top + innerH)} fill={`url(#${gradientId}-${i})`} />
              )}
              <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
              {hover !== null && points[hover] && (
                <circle cx={points[hover].x} cy={points[hover].y} r="4"
                  fill="rgb(var(--c-surface))" stroke={color} strokeWidth="2" />
              )}
            </g>
          );
        })}

        {/* Repère vertical au survol */}
        {hover !== null && (
          <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={PAD.top + innerH}
            stroke="rgb(var(--c-line2))" strokeWidth="1" strokeDasharray="3 3" />
        )}

        {/* Libellés de l'axe horizontal */}
        {labels.map((label, i) =>
          i % labelStep === 0 || i === labels.length - 1 ? (
            <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle"
              className="fill-ink3" style={{ fontSize: 10 }}>
              {label}
            </text>
          ) : null
        )}

        {/* Zones de survol — une bande par point, invisible mais cliquable */}
        {labels.map((_, i) => (
          <rect key={i} x={xAt(i) - innerW / labels.length / 2} y={PAD.top}
            width={innerW / labels.length} height={innerH} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>

      {hover !== null && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 bg-surface border border-line rounded-lg shadow-soft px-3 py-2 text-xs">
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
