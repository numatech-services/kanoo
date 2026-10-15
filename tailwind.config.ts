import type { Config } from "tailwindcss";

/**
 * Kanoo — Design system v3 « Harmattan » (chaud, éditorial, ancré Sahel).
 *
 * Les couleurs sont pilotées par des variables CSS (canaux RGB) définies dans
 * styles/globals.css, avec un thème clair et un thème sombre automatique
 * (prefers-color-scheme). Résultat : toute classe basée sur ces tokens
 * (bg-surface, text-ink, border-line, bg-section…) suit le mode sombre du
 * système sans code supplémentaire.
 *
 * Les alias historiques (sand/clay/cedar/moss) ont été retirés : `cedar`
 * pointait sur l'accent **global**, si bien que cent quarante-deux boutons
 * primaires ignoraient la teinte de la section où ils se trouvaient. Les
 * supprimer du thème est ce qui empêche leur retour — un test structurel les
 * refuse également.
 */
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  // Sombre : selon l'appareil, sauf choix manuel (data-theme sur <html>, posé
  // par la bascule de la barre du haut).
  darkMode: ["variant", ["@media (prefers-color-scheme: dark) { &:not([data-theme=light] *) }", "&:is([data-theme=dark] *)"]],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Neutres ──
        ink: c("--c-ink"),
        onink: c("--c-on-ink"),
        bg: c("--c-bg"),
        surface: c("--c-surface"),
        surface2: c("--c-surface2"),
        chrome: c("--c-chrome"),
        chromefg: c("--c-chrome-fg"),
        chromeactive: c("--c-chrome-active-bg"),
        chromeactivefg: c("--c-chrome-active-fg"),
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
        // ── Accent de la section courante (voir lib/sections.ts) ──
        // `bg-section`, `text-section`, `border-section`, `bg-section-soft`…
        // suivent l'attribut data-section posé par la coque.
        section: { DEFAULT: c("--s-accent"), soft: c("--s-soft"), on: c("--s-on") },
        // ── Palette catégorielle (voir lib/tone.ts) ──
        // L'accent de section dit *où l'on est* ; ces six teintes disent *de
        // quoi on parle*, et restent les mêmes d'un écran à l'autre.
        kat: {
          1: c("--k-1"), 2: c("--k-2"), 3: c("--k-3"),
          4: c("--k-4"), 5: c("--k-5"), 6: c("--k-6"),
        },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Arial", "sans-serif"],
        display: ["Plus Jakarta Sans", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "ui-monospace", "Menlo", "Consolas", "monospace"],
        hand: ["Caveat", "cursive"],
      },
      boxShadow: {
        soft: "0 14px 34px -12px rgba(30,40,80,.22)",
        sm: "0 1px 2px rgba(30,40,80,.06)",
        // Coque de l'application et cartes de la charte v5 : ombres longues et bleutées.
        shell: "0 30px 80px -30px rgba(44,60,130,.35)",
        card: "0 1px 2px rgba(30,40,80,.04), 0 12px 32px -18px rgba(44,60,130,.22)",
        glow: "0 10px 22px -10px rgba(47,89,223,.75)",
      },
    },
  },
  plugins: [],
};
export default config;
