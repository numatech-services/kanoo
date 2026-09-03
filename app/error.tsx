"use client";

import { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // En production : envoyer à Sentry ou service de monitoring
    if (process.env.NODE_ENV === "production") {
      console.error("[Kanoo] Erreur globale:", error.message, error.digest);
    }
  }, [error]);

  return (
    <div className="min-h-screen bg-surface2 flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-6xl mb-4">⚠️</p>
        <h1 className="text-2xl font-bold text-ink">Une erreur est survenue</h1>
        <p className="text-ink2 mt-3 leading-relaxed">
          Une erreur inattendue s'est produite. Nos équipes ont été notifiées.
        </p>
        {error.digest && (
          <p className="text-xs font-mono text-ink2/60 mt-2 bg-surface border border-line rounded-lg px-3 py-1.5 inline-block">
            Réf. : {error.digest}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <button
            onClick={reset}
            className="px-6 py-3 bg-section text-white rounded-xl font-medium hover:brightness-95 transition-colors"
          >
            Réessayer
          </button>
          <Link
            href="/dashboard"
            className="px-6 py-3 border border-line text-ink2 rounded-xl font-medium hover:bg-surface transition-colors"
          >
            Tableau de bord
          </Link>
        </div>
        <p className="text-xs text-ink2/60 mt-8">Kanoo · Si le problème persiste, contactez le support</p>
      </div>
    </div>
  );
}
