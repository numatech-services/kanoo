"use client";

import { usePathname } from "next/navigation";
import { sectionForPath } from "@/lib/sections";

/** Les trois espaces du produit. Voir `[data-space]` dans styles/globals.css. */
export type SpaceKey = "pme" | "association" | "administration";

/**
 * Pose `data-space` et `data-section` sur la coque.
 *
 * `data-space` porte l'identité de l'espace — couleur, forme, mouvement,
 * densité. `data-section` porte la teinte de l'onglet à l'intérieur de cet
 * espace. Les deux se combinent : un onglet « Finance » n'a pas la même
 * teinte chez une association que dans une administration, parce que les deux
 * espaces n'ont pas la même famille chromatique.
 *
 * Aucun écran n'a rien à déclarer : tout ce qui passe par les tokens suit.
 */
export function SectionScope({
  children, space = "pme",
}: { children: React.ReactNode; space?: SpaceKey }) {
  const pathname = usePathname();
  return (
    <div data-space={space} data-section={sectionForPath(pathname || "/")} className="contents">
      {children}
    </div>
  );
}
