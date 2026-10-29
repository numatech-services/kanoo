"use client";
import { SectionError } from "@/components/shared/SectionError";

/** Erreur d'une page de cet espace : affichée dans la coque, menu conservé. */
export default function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} />;
}
