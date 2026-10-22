/** Charte « Numatech » (v5) — mêmes teintes que l'application web. */
import { useColorScheme } from "react-native";

const light = {
  bg: "#F9FAFD", surface: "#FFFFFF", surface2: "#F1F3F9", line: "#E2E6EF",
  ink: "#161F32", ink2: "#353D4D", ink3: "#626978",
  accent: "#2F59DF", onAccent: "#FFFFFF",
  pos: "#1C5D4C", neg: "#B23B2E", warn: "#8C5E00",
  negSoft: "#F6E2DD", warnSoft: "#FAF3E3", posSoft: "#E2EDE8",
};
const dark: typeof light = {
  bg: "#131722", surface: "#1A1F2D", surface2: "#202636", line: "#282F40",
  ink: "#E6EAF5", ink2: "#ACB6CA", ink3: "#8C98AE",
  accent: "#7C9BE8", onAccent: "#131722",
  pos: "#4FB79A", neg: "#E06A5C", warn: "#D9A32A",
  negSoft: "#2A1714", warnSoft: "#2A2210", posSoft: "#16241F",
};

export type Theme = typeof light;
export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

/** « 1 250 000 FCFA » (le franc CFA n'a pas de décimales). */
export const fcfa = (n: number | undefined | null) =>
  `${Math.round(n ?? 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

/** « 2,4 M » pour les tuiles. */
export const compact = (n: number) =>
  Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(1).replace(".", ",")} Md` : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} M` : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export const dateFr = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");
