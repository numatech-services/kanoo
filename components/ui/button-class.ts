// Module neutre (ni client ni serveur) : les pages serveur appellent buttonClass()
// directement, ce qu'interdit un module « use client ».

/**
 * Bouton unique de l'application. L'audit d'octobre 2026 comptait 117 façons
 * différentes d'écrire un bouton (hauteurs, arrondis, graisses, couleurs) :
 * l'œil ne savait plus lequel était l'action principale de l'écran.
 *
 * - `primary`   : l'action principale de l'écran, une seule par zone.
 * - `secondary` : actions courantes (exporter, filtrer, annuler).
 * - `ghost`     : actions discrètes dans une ligne ou une barre d'outils.
 * - `danger`    : suppression, annulation définitive.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-section text-onink hover:brightness-95 shadow-sm",
  secondary: "bg-surface text-ink border border-line2 hover:bg-surface2",
  ghost: "text-ink2 hover:bg-surface2 hover:text-ink",
  danger: "bg-neg text-onink hover:brightness-95 shadow-sm",
};
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = "") {
  return `inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-section/40 focus-visible:ring-offset-1
    disabled:opacity-60 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.replace(/\s+/g, " ").trim();
}
