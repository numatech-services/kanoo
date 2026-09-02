"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZE_CLASSES = { 
  sm: "max-w-sm", 
  md: "max-w-lg", 
  lg: "max-w-2xl", 
  xl: "max-w-4xl" 
};

export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
  // 1. Empêcher l'erreur d'hydratation au niveau de la modale
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!open) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    // Bloquer le scroll du body quand la modale est ouverte
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  // 2. Utiliser un Portal pour injecter la modale hors de la hiérarchie DOM de la page
  // Cela évite que les styles de la page parente n'interfèrent avec le z-index
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/60 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${SIZE_CLASSES[size]} bg-white rounded-[2rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-clay/10 bg-sand/10">
          <h2 className="text-xl font-black text-ink italic uppercase tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="text-moss hover:text-cedar transition-all w-10 h-10 flex items-center justify-center rounded-full hover:bg-sand font-bold"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-8 overflow-y-auto max-h-[75vh]">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}