"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Ligne d'explication sous le titre. */
  description?: string;
  children: React.ReactNode;
  /** Boutons d'action, alignés à droite dans un pied fixe. */
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZE_CLASSES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
    if (!open) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  // Portail : la fenêtre échappe aux styles et au z-index de la page parente.
  // Sur téléphone, elle s'ancre en bas d'écran, à portée de pouce.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
      <div className="fixed inset-0 bg-ink/50 backdrop-blur-sm fade" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${SIZE_CLASSES[size]} bg-surface rounded-t-2xl sm:rounded-2xl shadow-soft border border-line overflow-hidden rise flex flex-col max-h-[92vh]`}
      >
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-line">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-ink">{title}</h2>
            {description && <p className="text-sm text-ink2 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-ink3 hover:text-ink w-8 h-8 -mr-1 flex items-center justify-center rounded-lg hover:bg-surface2 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 overflow-y-auto">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 px-5 sm:px-6 py-3 border-t border-line bg-surface2/40">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
