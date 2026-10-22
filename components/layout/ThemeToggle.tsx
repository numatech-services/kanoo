"use client";
import { useState, useSyncExternalStore } from "react";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";

type Theme = "auto" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<Theme, string> = { auto: "Thème : automatique (appareil)", light: "Thème : clair", dark: "Thème : sombre" };

// Choix gardé dans le navigateur ; « automatique » au rendu serveur et
// pendant l'hydratation, puis la valeur enregistrée.
const noSubscribe = () => () => {};
function storedTheme(): Theme {
  try { const t = localStorage.getItem("kanoo.theme"); if (t === "light" || t === "dark") return t; } catch { /* sans stockage : automatique */ }
  return "auto";
}

/**
 * Bascule de thème (charte v5) : automatique → clair → sombre. Le choix est
 * gardé dans le navigateur et posé sur <html data-theme> ; « automatique »
 * retire l'attribut et suit l'appareil.
 */
export function ThemeToggle() {
  const stored = useSyncExternalStore(noSubscribe, storedTheme, () => "auto" as Theme);
  // Choix fait ici ; prime sur la valeur lue (y compris sans stockage possible).
  const [chosen, setTheme] = useState<Theme | null>(null);
  const theme = chosen ?? stored;
  function cycle() {
    const next = NEXT[theme];
    setTheme(next);
    const root = document.documentElement;
    if (next === "auto") delete root.dataset.theme; else root.dataset.theme = next;
    try { if (next === "auto") localStorage.removeItem("kanoo.theme"); else localStorage.setItem("kanoo.theme", next); } catch { /* sans persistance */ }
  }
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : MonitorSmartphone;
  return (
    <button type="button" onClick={cycle} className="icon-pill" aria-label={`${LABEL[theme]} — changer`} title={LABEL[theme]}>
      <Icon size={18} />
    </button>
  );
}
