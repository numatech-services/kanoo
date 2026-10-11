"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

export interface TabItem {
  key: string;
  label: React.ReactNode;
  /** Onglet-lien : chaque onglet est une page (Stock › Entrepôts › Lots). */
  href?: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  /** Onglets d'état : clé active et changement. Ignorés pour des onglets-liens. */
  value?: string;
  onChange?: (key: string) => void;
  label?: string;
}

/**
 * Onglets accessibles (rôle tablist, flèches gauche/droite). Deux usages :
 * onglets d'état (`value` / `onChange`) ou onglets-liens (`href`), l'onglet
 * actif étant alors celui dont le chemin correspond le mieux à la page.
 */
export function Tabs({ items, value, onChange, label = "Onglets" }: TabsProps) {
  const pathname = usePathname();
  const listRef = useRef<HTMLDivElement>(null);
  const linkActive = items
    .filter(t => t.href && (pathname === t.href.split("?")[0] || pathname.startsWith(`${t.href.split("?")[0]}/`)))
    .sort((a, b) => (b.href!.length - a.href!.length))[0]?.key;
  const active = value ?? linkActive;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[role=tab]") ?? []);
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKey}
      className="flex gap-1 border-b border-line overflow-x-auto -mx-1 px-1">
      {items.map((t, idx) => {
        const selected = t.key === active;
        // Sans onglet actif, le premier reste joignable au clavier.
        const focusable = selected || (!active && idx === 0);
        const cls = `relative inline-flex items-center gap-2 h-10 px-3 text-sm whitespace-nowrap transition-colors
          ${selected ? "text-ink font-semibold" : "text-ink2 hover:text-ink"}`;
        const inner = (
          <>
            {t.label}
            {t.count !== undefined && (
              <span className={`num text-[11px] rounded-full px-1.5 ${selected ? "bg-section text-onink" : "bg-surface2 text-ink2"}`}>{t.count}</span>
            )}
            {selected && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded bg-section" aria-hidden />}
          </>
        );
        return t.href ? (
          <Link key={t.key} href={t.href} role="tab" aria-selected={selected} tabIndex={focusable ? 0 : -1} className={cls}>{inner}</Link>
        ) : (
          <button key={t.key} type="button" role="tab" aria-selected={selected} tabIndex={focusable ? 0 : -1}
            onClick={() => onChange?.(t.key)} className={cls}>{inner}</button>
        );
      })}
    </div>
  );
}
