"use client";

import { Children, cloneElement, isValidElement, ReactElement, ReactNode, useId } from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

const FIELD_TAGS = new Set(["input", "select", "textarea"]);

/**
 * Libellé + champ + aide/erreur. Quand le champ est un `<input>`, `<select>`
 * ou `<textarea>` unique, il reçoit un identifiant relié au libellé : un clic
 * sur le libellé place le curseur dans le champ, et un lecteur d'écran annonce
 * le libellé, l'aide et l'erreur (le libellé n'était jusqu'ici relié à rien).
 */
export function FormField({ label, required, error, hint, children, className = "" }: FormFieldProps) {
  const auto = useId();
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const field = isValidElement(only) && typeof only.type === "string" && FIELD_TAGS.has(only.type)
    ? (only as ReactElement<Record<string, unknown>>) : null;
  const id = field ? (field.props.id as string | undefined) ?? auto : undefined;
  const noteId = id && (hint || error) ? `${id}-note` : undefined;

  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-ink2" htmlFor={id}>
        {label}
        {required && <span className="text-neg ml-1" aria-hidden>*</span>}
      </label>
      {field ? cloneElement(field, {
        id,
        "aria-invalid": error ? true : field.props["aria-invalid"],
        "aria-describedby": noteId ?? field.props["aria-describedby"],
        "aria-required": required || field.props["aria-required"] || undefined,
      }) : children}
      {hint && !error && <p id={noteId} className="text-xs text-ink2/70">{hint}</p>}
      {error && <p id={noteId} className="text-xs text-neg" role="alert">{error}</p>}
    </div>
  );
}

// Classes partagées des champs, pour des formulaires homogènes.
export const inputCls = "w-full px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30 bg-surface disabled:bg-surface2 disabled:text-ink2";
export const selectCls = inputCls;
export const textareaCls = `${inputCls} resize-y`;
