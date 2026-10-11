"use client";

import { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, required, error, hint, children, className = "" }: FormFieldProps) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-ink2">
        {label}
        {required && <span className="text-neg ml-1">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-ink2/70">{hint}</p>}
      {error && <p className="text-xs text-neg">{error}</p>}
    </div>
  );
}

// Shared input/select class strings for consistency across forms
export const inputCls = "w-full px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30 bg-surface disabled:bg-surface2 disabled:text-ink2";
export const selectCls = inputCls;
export const textareaCls = `${inputCls} resize-y`;
