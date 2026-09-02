"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Sparkline } from "./charts/Sparkline";

export interface KpiCardProps {
  label: string;
  /** Valeur déjà formatée. Le composant ne décide jamais d'une unité. */
  value: string;
  icon?: ReactNode;
  /**
   * Variation par rapport à la période précédente, en points de pourcentage.
   * Laisser `undefined` quand la comparaison n'est pas calculable — un « 0 % »
   * affiché par défaut se lit comme une stabilité mesurée, ce qui est faux.
   */
  delta?: number;
  deltaLabel?: string;
  /**
   * Sens souhaité de la variation. Pour un encours client ou un impayé, une
   * hausse est une mauvaise nouvelle : le vert et le rouge doivent s'inverser.
   */
  goodDirection?: "up" | "down";
  trend?: number[];
  href?: string;
  /** Teinte propre. Par défaut, l'accent de la section courante. */
  tone?: "section" | "pos" | "neg" | "warn" | "info";
  hint?: string;
}

const TONE: Record<NonNullable<KpiCardProps["tone"]>, { chip: string; spark: string }> = {
  section: { chip: "bg-section-soft text-section", spark: "rgb(var(--s-accent))" },
  pos:     { chip: "bg-pos-50 text-pos",           spark: "rgb(var(--c-pos))" },
  neg:     { chip: "bg-neg-50 text-neg",           spark: "rgb(var(--c-neg))" },
  warn:    { chip: "bg-warn-50 text-warn",         spark: "rgb(var(--c-warn))" },
  info:    { chip: "bg-info-50 text-info",         spark: "rgb(var(--c-info))" },
};

/**
 * Carte d'indicateur : pastille d'icône colorée, valeur, variation, et micro-courbe.
 *
 * La variation n'est affichée que si elle a été calculée. Rien n'est inventé
 * pour remplir la carte.
 */
export function KpiCard({
  label, value, icon, delta, deltaLabel = "vs période précédente",
  goodDirection = "up", trend, href, tone = "section", hint,
}: KpiCardProps) {
  const t = TONE[tone];

  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const rising = hasDelta && delta > 0;
  const flat = hasDelta && delta === 0;
  const favourable = hasDelta && (goodDirection === "up" ? delta > 0 : delta < 0);

  const deltaClass = !hasDelta || flat
    ? "text-ink3"
    : favourable ? "text-pos" : "text-neg";

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink2 truncate">{label}</p>
          <p className="text-2xl font-bold text-ink num mt-1 leading-tight">{value}</p>
        </div>
        {icon && (
          <span className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${t.chip}`}>
            {icon}
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-3 mt-3">
        <div className="min-w-0">
          {hasDelta ? (
            <p className={`text-xs font-semibold flex items-center gap-1 ${deltaClass}`}>
              <span aria-hidden>{flat ? "→" : rising ? "↑" : "↓"}</span>
              <span className="num">
                {delta > 0 ? "+" : ""}{delta.toFixed(1).replace(".", ",")}&nbsp;%
              </span>
              <span className="font-normal text-ink3 truncate">{deltaLabel}</span>
            </p>
          ) : (
            <p className="text-xs text-ink3 truncate">{hint || "Pas de comparaison disponible"}</p>
          )}
        </div>
        {trend && trend.length > 1 && (
          <Sparkline values={trend} color={t.spark} width={92} height={28} className="shrink-0" />
        )}
      </div>
    </>
  );

  const shell = "bg-surface rounded-xl border border-line p-4 shadow-sm transition-colors";

  return href ? (
    <Link href={href} className={`${shell} block hover:border-section focus-visible:border-section`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
