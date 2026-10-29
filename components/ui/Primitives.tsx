"use client";

import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { avatarTone, initials, toneVar, type ToneRole, type ToneKey } from "@/lib/tone";

// ─────────────────────────────────────────────────────────────────────────────
// Pilule d'état
// ─────────────────────────────────────────────────────────────────────────────

export type PillTone = "pos" | "neg" | "warn" | "info" | "mute" | "section";

const PILL_ICON: Partial<Record<PillTone, typeof Info>> = {
  pos: CheckCircle2, neg: XCircle, warn: AlertTriangle, info: Info,
};

/**
 * Un état, lisible à sa forme autant qu'à sa couleur.
 *
 * L'icône n'est pas décorative : elle permet de distinguer « réglé » de
 * « en retard » sans dépendre du vert et du rouge, que huit hommes sur cent
 * ne séparent pas.
 */
export function Pill({
  tone = "mute", children, icon, dot = false, className = "",
}: {
  tone?: PillTone; children: ReactNode; icon?: ReactNode;
  dot?: boolean; className?: string;
}) {
  const Auto = PILL_ICON[tone];
  return (
    <span className={`pill pill-${tone} ${dot ? "pill-dot" : ""} ${className}`}>
      {!dot && (icon ?? (Auto ? <Auto size={11} strokeWidth={2.5} /> : null))}
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Écart par rapport à la période précédente.
 *
 * `goodDirection` inverse les couleurs là où monter est une mauvaise
 * nouvelle : un encours client qui grimpe n'est pas une réussite. Sans ce
 * réglage, un tableau de bord félicite l'utilisateur pour ses impayés.
 */
export function Delta({
  value, goodDirection = "up", suffix = "%", label,
}: { value?: number; goodDirection?: "up" | "down"; suffix?: string; label?: string }) {
  // Pas de comparaison calculable : ne rien afficher. Un « 0 % » posé par
  // défaut se lit comme une stabilité mesurée, ce qui est faux.
  if (value === undefined || !Number.isFinite(value)) return null;

  const flat = Math.abs(value) < 0.05;
  const good = goodDirection === "up" ? value > 0 : value < 0;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const cls = flat ? "text-ink3" : good ? "text-pos" : "text-neg";

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${cls}`}>
      <Icon size={13} strokeWidth={2.5} />
      <span className="num">{value > 0 ? "+" : ""}{value.toFixed(1)}{suffix}</span>
      {label && <span className="font-normal text-ink3">{label}</span>}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pastille d'icône
// ─────────────────────────────────────────────────────────────────────────────

export function Chip({
  icon, tone, solid = false, size = "md",
}: { icon: ReactNode; tone?: ToneRole | ToneKey; solid?: boolean; size?: "md" | "lg" }) {
  return (
    <span className={`chip ${size === "lg" ? "chip-lg" : ""} ${solid ? "chip-solid" : ""}`}
      style={tone ? toneVar(tone) : undefined}>
      {icon}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────────────────────────────

export function Avatar({
  name, size = "md",
}: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`avatar ${size === "sm" ? "avatar-sm" : size === "lg" ? "avatar-lg" : ""}`}
      style={avatarTone(name)} title={name} aria-hidden>
      {initials(name)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Encart d'explication
// ─────────────────────────────────────────────────────────────────────────────

const INSET_ICON = { warn: AlertTriangle, info: Info, pos: CheckCircle2, neg: XCircle };

/** Une consigne posée dans la carte qu'elle concerne, jamais en haut de page. */
export function Inset({
  tone = "info", children,
}: { tone?: "warn" | "info" | "pos" | "neg"; children: ReactNode }) {
  const Icon = INSET_ICON[tone];
  return (
    <div className={`inset inset-${tone}`}>
      <Icon size={14} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chips de filtre
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterOption {
  key: string;
  label: string;
  /** Le compteur fait partie du filtre : c'est lui qui décide de cliquer. */
  count?: number;
}

export function FilterChips({
  options, value, onChange, className = "",
}: {
  options: FilterOption[];
  value: string | null;
  onChange: (key: string | null) => void;
  className?: string;
}) {
  return (
    // Sur téléphone, une seule ligne qui défile (huit filtres prenaient quatre
    // lignes avant la liste) ; à partir de la tablette, ils passent à la ligne.
    <div className={`flex flex-nowrap sm:flex-wrap items-center gap-2 overflow-x-auto sm:overflow-visible -mx-1 px-1 pb-1 sm:pb-0 max-w-full ${className}`} role="group">
      {options.map(o => {
        const on = value === o.key;
        return (
          <button key={o.key} type="button" aria-pressed={on} className="fchip shrink-0 whitespace-nowrap"
            onClick={() => onChange(on ? null : o.key)}>
            {o.label}
            {o.count !== undefined && <span className="fchip-count num">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Micro-barre
// ─────────────────────────────────────────────────────────────────────────────

/** Une proportion se voit avant de se lire ; la barre devance le chiffre. */
export function MiniBar({
  value, max, tone,
}: { value: number; max: number; tone?: ToneRole | ToneKey }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <span className="mini-bar" style={tone ? toneVar(tone) : undefined}
      role="img" aria-label={`${Math.round(pct)} %`}>
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bandeau d'indicateurs
// ─────────────────────────────────────────────────────────────────────────────

export interface StripItem {
  label: string;
  value: string;
  /** Unité posée après la valeur, en petit : « 20 patients », « 12 min ». */
  unit?: string;
  icon?: ReactNode;
  tone?: ToneRole | ToneKey;
  pill?: { tone: PillTone; text: string };
  href?: string;
}

/**
 * Quatre chiffres d'une même respiration, dans une seule carte traversante.
 *
 * Juxtaposer quatre cartes sépare visuellement ce qui appartient au même
 * relevé ; les séparateurs disent le contraire, et se lisent d'un trait.
 */
export function StatStrip({ items }: { items: StripItem[] }) {
  return (
    <div className="strip" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
      {items.map((item, i) => {
        const inner = (
          <div className="flex items-start gap-3">
            {item.icon && <Chip icon={item.icon} tone={item.tone} solid />}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink2 truncate">{item.label}</p>
              <p className="mt-0.5 flex items-baseline gap-1.5 flex-wrap">
                <span className="text-xl font-bold text-ink num">{item.value}</span>
                {item.unit && <span className="text-xs text-ink3">{item.unit}</span>}
                {item.pill && <Pill tone={item.pill.tone}>{item.pill.text}</Pill>}
              </p>
            </div>
          </div>
        );
        return item.href
          ? <Link key={i} href={item.href} className="block hover:bg-surface2/50 transition-colors">{inner}</Link>
          : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bandeau d'impact
// ─────────────────────────────────────────────────────────────────────────────

export interface ImpactItem {
  value: string;
  unit?: string;
  /** La phrase qui dit ce que le chiffre signifie. Elle n'est pas optionnelle. */
  caption: string;
  href?: string;
}

/**
 * Le bandeau de tête.
 *
 * Chaque chiffre porte sa phrase. Un nombre seul se retient mal et
 * s'interprète de travers — « 4 200 000 » ne dit ni de quoi il s'agit, ni si
 * c'est une bonne nouvelle.
 */
export function ImpactBand({
  title, icon, items, style,
}: { title: string; icon?: ReactNode; items: ImpactItem[]; style?: CSSProperties }) {
  return (
    <section className="band rise" style={style}>
      <header className="px-5 py-3 flex items-center gap-2 text-sm font-semibold
                         bg-black/10">
        {icon}{title}
      </header>
      <div className="band-inner"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 12rem), 1fr))` }}>
        {items.map((item, i) => {
          const inner = (
            <>
              <p className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-bold num tracking-tight">{item.value}</span>
                {item.unit && <span className="text-sm text-white/70">{item.unit}</span>}
              </p>
              <p className="mt-1.5 text-xs text-white/80 underline decoration-white/30
                            underline-offset-4 leading-relaxed">
                {item.caption}
              </p>
            </>
          );
          return item.href
            ? <Link key={i} href={item.href} className="hover:bg-black/10 transition-colors">{inner}</Link>
            : <div key={i}>{inner}</div>;
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// En-tête de section
// ─────────────────────────────────────────────────────────────────────────────

/** Titre de groupe avec, à droite, le lien vers la vue complète. */
export function SectionHead({
  title, hint, action,
}: { title: string; hint?: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3">
      <div>
        <h2 className="font-semibold text-ink">{title}</h2>
        {hint && <p className="text-xs text-ink2 mt-0.5">{hint}</p>}
      </div>
      {action && (
        <Link href={action.href}
          className="text-xs font-medium text-section hover:underline whitespace-nowrap shrink-0">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// État vide
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un écran vide doit dire quoi faire.
 *
 * « Aucune donnée » laisse l'utilisateur devant un mur ; la première action
 * possible le fait avancer.
 */
export function EmptyState({
  icon, title, hint, action,
}: {
  icon?: ReactNode; title: string; hint?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="surface-card p-12 text-center">
      {icon && (
        <span className="mx-auto mb-3 chip chip-lg" aria-hidden>{icon}</span>
      )}
      <p className="font-medium text-ink">{title}</p>
      {hint && <p className="text-sm text-ink2 mt-1 max-w-md mx-auto">{hint}</p>}
      {action && (
        <Link href={action.href}
          className="mt-4 inline-flex items-center h-10 px-4 rounded-lg bg-section
                     text-onink text-sm font-semibold hover:brightness-95">
          {action.label}
        </Link>
      )}
    </div>
  );
}
