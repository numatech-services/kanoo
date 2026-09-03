"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Sparkline } from "./charts/Sparkline";
import { useCountUp } from "@/lib/use-count-up";
import { toneVar, toneColor, type ToneRole } from "@/lib/tone";

export interface KpiCardProps {
  label: string;
  /**
   * Valeur affichée. Une chaîne est posée telle quelle ; un nombre accompagné
   * de `format` est compté progressivement de son ancienne valeur à la
   * nouvelle. Le composant ne décide jamais d'une unité — le formatage reste
   * à l'appelant.
   */
  value: string | number;
  format?: (n: number) => string;
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
  /**
   * Teinte propre. Par défaut, l'accent de la section courante.
   *
   * Les valeurs sémantiques (`pos`, `neg`…) portent un jugement : à réserver
   * aux indicateurs qui en appellent un. Les rôles catégoriels
   * (`revenue`, `volume`…) ne jugent pas, ils distinguent — et gardent la
   * même teinte d'un écran à l'autre.
   */
  tone?: "section" | "pos" | "neg" | "warn" | "info" | ToneRole;
  hint?: string;
}

const TONE: Record<"section" | "pos" | "neg" | "warn" | "info", { chip: string; spark: string }> = {
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
  label, value, format, icon, delta, deltaLabel = "vs période précédente",
  goodDirection = "up", trend, href, tone = "section", hint,
}: KpiCardProps) {
  // Une teinte catégorielle passe par la variable --chip ; une teinte
  // sémantique garde ses classes utilitaires.
  const categorical = !(tone in TONE);
  const t = categorical ? null : TONE[tone as keyof typeof TONE];
  const chipStyle = categorical ? toneVar(tone as ToneRole) : undefined;
  const sparkColor = categorical ? toneColor(tone as ToneRole) : t!.spark;

  // Le comptage n'est branché que sur une valeur numérique : animer une chaîne
  // n'aurait aucun sens, et le hook doit être appelé inconditionnellement.
  const numeric = typeof value === "number" ? value : 0;
  const counted = useCountUp(numeric);
  const display = typeof value === "number"
    ? (format ? format(counted) : Math.round(counted).toLocaleString("fr-FR"))
    : value;

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
          <p className="text-2xl font-bold text-ink num mt-1 leading-tight tabular-nums">{display}</p>
        </div>
        {icon && (
          <span className={`chip ${t ? t.chip : ""}`} style={chipStyle}>
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
          <Sparkline values={trend} color={sparkColor} width={92} height={28} className="shrink-0" />
        )}
      </div>
    </>
  );

  const shell = "bg-surface rounded-xl border border-line p-4 shadow-sm rise";

  return href ? (
    <Link href={href} className={`${shell} lift block hover:border-section focus-visible:border-section`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
