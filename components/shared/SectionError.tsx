"use client";

import { useEffect } from "react";
import { PageError } from "@/components/ui/PageState";
import { reportClientError } from "@/components/shared/ErrorReporter";

/**
 * Erreur de rendu d'une page de l'espace connecté : affichée DANS la coque
 * (menu conservé), avec sa référence et « Réessayer ». La page d'erreur
 * globale (app/error.tsx) reste pour ce qui casse la coque elle-même.
 */
export function SectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError({ message: error.message || "Erreur de rendu", stack: error.stack, digest: error.digest });
  }, [error]);
  return <PageError message="Une erreur inattendue s'est produite sur cette page. Nos équipes ont été notifiées." reference={error.digest} onRetry={reset} />;
}
