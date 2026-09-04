"use client";

import { CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { sectionForPath } from "@/lib/sections";
import { useMe } from "@/lib/useMe";

/** Les trois espaces du produit. Voir `[data-space]` dans styles/globals.css. */
export type SpaceKey = "pme" | "association" | "administration";

/** Couleur d'accent par défaut de l'organisation (Tenant.branding.primaryColor).
 *  Tant qu'elle vaut ce défaut, on garde la palette riche par section. */
const DEFAULT_PRIMARY = "#2f3e46";

/** "#RRGGBB" → "R G B" (canaux séparés, comme attend `rgb(var(--s-accent))`). */
function toChannels(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Luminance relative approx., pour choisir un texte lisible sur l'accent. */
function isLight(channels: string): boolean {
  const [r, g, b] = channels.split(" ").map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

/** Teinte douce = accent mélangé à 86 % de blanc (fond des puces, pilules). */
function softOf(channels: string): string {
  return channels.split(" ").map((c) => Math.round(Number(c) * 0.14 + 255 * 0.86)).join(" ");
}

/**
 * Pose `data-space` et `data-section` sur la coque, et — si l'organisation a
 * choisi une couleur principale propre — teinte l'accent de toute l'interface
 * avec cette couleur (sinon, la palette par section s'applique).
 *
 * `data-space` porte l'identité de l'espace ; il suit le type de l'organisation
 * (PME / association / administration) plutôt qu'une valeur figée, pour qu'une
 * association voie bien l'identité « Baobab » et une administration « Ténéré ».
 */
export function SectionScope({
  children, space = "pme",
}: { children: React.ReactNode; space?: SpaceKey }) {
  const pathname = usePathname();
  const { tenant } = useMe();

  const effectiveSpace: SpaceKey =
    tenant?.type === "association" || tenant?.type === "administration" || tenant?.type === "pme"
      ? tenant.type
      : space;

  // Accent personnalisé : uniquement si l'organisation a réellement changé sa
  // couleur (≠ défaut). Un override en ligne bat les règles `[data-section]`.
  let style: CSSProperties | undefined;
  const primary = tenant?.primaryColor?.toLowerCase();
  if (primary && primary !== DEFAULT_PRIMARY) {
    const ch = toChannels(primary);
    if (ch) {
      style = {
        ["--s-accent" as string]: ch,
        ["--s-soft" as string]: softOf(ch),
        ["--s-on" as string]: isLight(ch) ? "11 16 32" : "255 255 255",
      };
    }
  }

  return (
    <div data-space={effectiveSpace} data-section={sectionForPath(pathname || "/")} className="contents" style={style}>
      {children}
    </div>
  );
}
