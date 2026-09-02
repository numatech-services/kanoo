import type { Config } from "tailwindcss";

/**
 * Kanoo — Design system v3 « Harmattan » (chaud, éditorial, ancré Sahel).
 *
 * Les couleurs sont pilotées par des variables CSS (canaux RGB) définies dans
 * styles/globals.css, avec un thème clair et un thème sombre automatique
 * (prefers-color-scheme). Résultat : toute classe basée sur ces tokens
 * (bg-surface, text-ink, border-line, bg-cedar…) suit le mode sombre du système
 * sans code supplémentaire. Les tokens historiques (sand/clay/cedar/moss/ember)
 * sont conservés et re-câblés sur les variables pour une migration sans casse.
 */
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: "media",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Tokens historiques, re-câblés sur Harmattan ──
        ink: c("--c-ink"),
        sand: c("--c-bg"),
        clay: c("--c-line2"),
        cedar: c("--c-accent"),
        moss: c("--c-ink2"),
        ember: c("--c-neg"),
        // ── Neutres ──
        bg: c("--c-bg"),
        surface: c("--c-surface"),
        surface2: c("--c-surface2"),
        ink2: c("--c-ink2"),
        ink3: c("--c-ink3"),
        line: c("--c-line"),
        line2: c("--c-line2"),
        // ── Accent soleil d'harmattan + sémantique ──
        accent: { DEFAULT: c("--c-accent"), 600: c("--c-accent600"), 700: c("--c-accent700"), 50: c("--c-accent050"), 100: c("--c-accent100") },
        acacia: { DEFAULT: c("--c-pos"), 50: c("--c-pos050") },
        pos: { DEFAULT: c("--c-pos"), 50: c("--c-pos050") },
        neg: { DEFAULT: c("--c-neg"), 50: c("--c-neg050") },
        warn: { DEFAULT: c("--c-warn"), 50: c("--c-warn050") },
        info: { DEFAULT: c("--c-info"), 50: c("--c-info050") },
      },
      fontFamily: {
        sans: ["Hanken Grotesk", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Arial", "sans-serif"],
        display: ["Fraunces", "Georgia", "serif"],
        mono: ["SF Mono", "ui-monospace", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        soft: "0 14px 34px -12px rgba(23,19,14,.28)",
        sm: "0 1px 2px rgba(23,19,14,.06)",
      },
    },
  },
  plugins: [],
};
export default config;
