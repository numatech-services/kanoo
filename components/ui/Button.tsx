"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { buttonClass, type ButtonVariant, type ButtonSize } from "./button-class";

export { buttonClass };
export type { ButtonVariant, ButtonSize };

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
