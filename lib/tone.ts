/**
 * Teintes catégorielles.
 *
 * Une teinte n'est utile que si elle est stable : le chiffre d'affaires doit
 * porter la même couleur sur le tableau de bord, dans le graphique et sur
 * l'export. Ce module est la seule source, pour que ce soit vrai.
 */

export type ToneKey = 1 | 2 | 3 | 4 | 5 | 6;

/** Rôles nommés plutôt que numéros : `tone("revenue")` se relit, `tone(1)` non. */
export const TONE_ROLES = {
  revenue: 1,     // encaissements, chiffre d'affaires
  volume: 2,      // nombre de pièces, cadence
  pending: 3,     // en attente, à traiter
  parties: 4,     // clients, fournisseurs, membres
  recurring: 5,   // abonnements, contrats récurrents
  margin: 6,      // marge, résultat, épargne
} as const satisfies Record<string, ToneKey>;

export type ToneRole = keyof typeof TONE_ROLES;

/** Variable CSS à poser en style inline : `style={toneVar("revenue")}`. */
export function toneVar(role: ToneRole | ToneKey): React.CSSProperties {
  const key = typeof role === "number" ? role : TONE_ROLES[role];
  return { ["--chip" as string]: `var(--k-${key})` };
}

/** Couleur résolue, pour les graphiques SVG qui ont besoin d'une valeur. */
export function toneColor(role: ToneRole | ToneKey): string {
  const key = typeof role === "number" ? role : TONE_ROLES[role];
  return `rgb(var(--k-${key}))`;
}

/**
 * Teinte dérivée d'un nom.
 *
 * Un hachage, pas un aléatoire : la même personne garde sa couleur d'une
 * session à l'autre et d'un écran à l'autre. Une couleur qui change à chaque
 * rendu n'aide personne à reconnaître qui que ce soit.
 */
export function avatarTone(name: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return toneVar(((Math.abs(hash) % 6) + 1) as ToneKey);
}

/** Initiales : deux lettres au plus, sur les deux premiers mots utiles. */
export function initials(name: string): string {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
