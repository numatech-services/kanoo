"use client";

import { usePathname } from "next/navigation";
import { sectionForPath } from "@/lib/sections";

/**
 * Pose l'attribut `data-section` d'après la route courante.
 *
 * Toute la teinte de la page en découle : les variables `--s-accent` et
 * `--s-soft` sont redéfinies par cet attribut (voir styles/globals.css), et les
 * classes `bg-section`, `text-section`, `bg-section-soft` les suivent. Un écran
 * n'a donc rien à déclarer pour prendre la couleur de son domaine.
 */
export function SectionScope({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div data-section={sectionForPath(pathname || "/")} className="contents">
      {children}
    </div>
  );
}
