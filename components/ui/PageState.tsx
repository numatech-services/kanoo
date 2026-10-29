"use client";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";

/**
 * États d'une page : chargement (squelette) et erreur (message, réessayer).
 * Une page ne s'affiche plus blanche — ni pendant le chargement, ni pour
 * toujours quand la lecture échoue.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`bg-surface2 rounded-xl animate-pulse ${className}`} />;
}

export function PageLoading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="surface-card p-4 space-y-3">
        {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9" />)}
      </div>
    </div>
  );
}

export function PageError({ message, onRetry, reference }: { message?: string; onRetry?: () => void; reference?: string }) {
  return (
    <div role="alert" className="surface-card p-8 text-center max-w-lg mx-auto space-y-3">
      <p className="flex justify-center text-warn" aria-hidden><AlertTriangle size={36} /></p>
      <h2 className="text-lg font-semibold text-ink">Impossible d&apos;afficher cette page</h2>
      <p className="text-sm text-ink2">{message || "La lecture des données a échoué. Vérifiez la connexion et réessayez."}</p>
      {reference && <p className="text-xs font-mono text-ink3">Réf. : {reference}</p>}
      {onRetry && <button onClick={onRetry} className={buttonClass("primary", "md")}><RotateCcw size={15} /> Réessayer</button>}
    </div>
  );
}
