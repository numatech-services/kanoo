"use client";

import { useState, createContext, useContext, useCallback, useEffect, ReactNode } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// Accès hors composant (gestionnaires d'erreur, utilitaires) : le fournisseur
// monté à la racine s'enregistre ici.
let globalToast: ToastContextValue["toast"] | null = null;

/** Affiche un message éphémère depuis n'importe où dans le code client. */
export function showToast(message: string, type: ToastType = "info") {
  if (globalToast) globalToast(message, type);
  else if (typeof window !== "undefined") console.warn(message);
}

const ICONS: Record<ToastType, ReactNode> = {
  success: <CheckCircle2 size={16} />, error: <XCircle size={16} />,
  warning: <AlertTriangle size={16} />, info: <Info size={16} />,
};
const BG: Record<ToastType, string> = {
  success: "bg-pos-50 border-pos/25 text-pos",
  error:   "bg-neg-50 border-neg/25 text-neg",
  warning: "bg-warn-50 border-warn/25 text-warn",
  info:    "bg-info-50 border-info/25 text-info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    // Une erreur reste plus longtemps : on doit avoir le temps de la lire.
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), type === "error" ? 7000 : 4000);
  }, []);

  useEffect(() => {
    globalToast = toast;
    return () => { if (globalToast === toast) globalToast = null; };
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-24 lg:bottom-5 right-4 left-4 sm:left-auto z-[110] flex flex-col gap-2 pointer-events-none" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-soft text-sm font-medium pointer-events-auto rise sm:max-w-sm ${BG[t.type]}`}
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.type]}</span>
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              aria-label="Fermer"
              className="ml-2 opacity-60 hover:opacity-100 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
