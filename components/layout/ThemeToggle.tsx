"use client";
import { useEffect, useState } from "react";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";

type Theme = "auto" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<Theme, string> = { auto: "Thème : automatique (appareil)", light: "Thème : clair", dark: "Thème : sombre" };

/**
 * Bascule de thème (charte v5) : automatique → clair → sombre. Le choix est
 * gardé dans le navigateur et posé sur <html data-theme> ; « automatique »
 * retire l'attribut et suit l'appareil.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("auto");
  useEffect(() => {
    try { const t = localStorage.getItem("kanoo.theme"); if (t === "light" || t === "dark") setTheme(t); } catch { /* sans stockage : automatique */ }
  }, []);
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
