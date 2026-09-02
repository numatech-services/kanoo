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
      <label className="block text-xs font-medium text-moss">
        {label}
        {required && <span className="text-ember ml-1">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-moss/70">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// Shared input/select class strings for consistency across forms
export const inputCls = "w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30 bg-white disabled:bg-sand disabled:text-moss";
export const selectCls = inputCls;
export const textareaCls = `${inputCls} resize-y`;
