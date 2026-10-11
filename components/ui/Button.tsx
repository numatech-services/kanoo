"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

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

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Action en cours : désactive le bouton et affiche un indicateur. */
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, className = "", disabled, children, type = "button", ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Loader2 size={size === "sm" ? 13 : 15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface LinkButtonProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
}

/** Lien présenté comme un bouton (« Nouvelle facture » qui ouvre une page). */
export function LinkButton({ href, variant = "primary", size = "md", icon, className = "", children, ...rest }: LinkButtonProps) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {icon}{children}
    </Link>
  );
}
