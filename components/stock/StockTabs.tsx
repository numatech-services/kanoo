"use client";

import { Tabs } from "@/components/ui/Tabs";

/** Les écrans du stock, reliés entre eux : on passe des articles aux lots sans repasser par le menu. */
export function StockTabs() {
  return (
    <Tabs label="Écrans du stock" items={[
      { key: "stock", label: "Articles", href: "/stock" },
      { key: "mouvements", label: "Mouvements", href: "/stock/mouvements" },
      { key: "entrepots", label: "Entrepôts", href: "/stock/entrepots" },
      { key: "lots", label: "Lots & péremptions", href: "/stock/lots" },
      { key: "inventaires", label: "Inventaires", href: "/inventaires" },
    ]} />
  );
}
