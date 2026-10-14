"use client";

import { Tabs, type TabItem } from "@/components/ui/Tabs";

/**
 * Onglets d'une famille d'écrans : chaque sous-écran reste joignable depuis
 * les autres sans repasser par le menu.
 */
const GROUPS: Record<string, { label: string; items: TabItem[] }> = {
  accounting: { label: "Écrans de la comptabilité", items: [
    { key: "journal", label: "Écritures", href: "/accounting" },
    { key: "etats", label: "États comptables", href: "/accounting/etats" },
    { key: "lettrage", label: "Lettrage", href: "/accounting/lettrage" },
    { key: "plan", label: "Plan comptable", href: "/accounting/plan" },
    { key: "reprise", label: "Soldes d'ouverture", href: "/accounting/reprise" },
  ]},
  fiscalite: { label: "Écrans de la fiscalité", items: [
    { key: "home", label: "Calendrier", href: "/fiscalite" },
    { key: "tva", label: "TVA", href: "/fiscalite/tva" },
    { key: "cnss", label: "CNSS", href: "/fiscalite/cnss" },
    { key: "isbic", label: "IS / BIC", href: "/fiscalite/isbic" },
    { key: "retenues", label: "Retenues à la source", href: "/fiscalite/retenues" },
  ]},
};

export function ScreenTabs({ group }: { group: keyof typeof GROUPS }) {
  const g = GROUPS[group];
  return <Tabs label={g.label} items={g.items} />;
}
