/**
 * Géométrie partagée des graphiques.
 *
 * Tout est dessiné en SVG, sans bibliothèque : le projet n'en embarque aucune,
 * et une courbe de trésorerie ne justifie pas 200 Ko de JavaScript sur des
 * connexions qui coupent. Les courbes sont lissées par une conversion
 * Catmull-Rom → Bézier, qui passe exactement par chaque point mesuré — un
 * lissage qui *invente* des sommets entre deux mois donnerait à lire un
 * mouvement qui n'existe pas.
 */

export interface Point { x: number; y: number; }

export interface Scale {
  min: number;
  max: number;
  /** Convertit une valeur de la série en coordonnée SVG. */
  to(value: number): number;
}

/**
 * Échelle linéaire. Une série plate reçoit une amplitude artificielle de 1
 * pour ne pas diviser par zéro et pour se dessiner au milieu du cadre.
 */
export function linearScale(values: number[], from: number, to: number, includeZero = true): Scale {
  const finite = values.filter(Number.isFinite);
  let min = finite.length ? Math.min(...finite) : 0;
  let max = finite.length ? Math.max(...finite) : 0;
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) { min -= 0.5; max += 0.5; }

  return {
    min, max,
    to: (value: number) => {
      const ratio = (value - min) / (max - min);
      return from + ratio * (to - from);
    },
  };
}

/**
 * Chemin lissé passant par tous les points (Catmull-Rom → Bézier cubique).
 * `tension` à 0 donne une ligne brisée, 1 un lissage franc ; 0,5 est le
 * compromis qui reste fidèle aux données.
 */
export function smoothPath(points: Point[], tension = 0.5): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const d: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension;

    d.push(`C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`);
  }
  return d.join(" ");
}

/** Ferme un tracé vers la ligne de base, pour l'aire sous la courbe. */
export function areaPath(points: Point[], baseline: number, tension = 0.5): string {
  if (points.length === 0) return "";
  const line = smoothPath(points, tension);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}

/** Graduations « rondes » — 0, 250, 500… plutôt que 0, 237, 474. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude;

  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step / 1000; t += step) {
    ticks.push(Math.round(t * 1e6) / 1e6);
  }
  return ticks;
}

/** Format court pour les axes : 1 200 000 → « 1,2 M ». */
export function compactXof(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(".", ",")} Md`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")} M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)} k`;
  return String(Math.round(value));
}

/** Montant complet, pour les infobulles et les valeurs mises en avant. */
export function fullXof(value: number): string {
  return `${Math.round(value).toLocaleString("fr-FR")} XOF`;
}

/**
 * Barre à sommet arrondi.
 *
 * Un `rect` avec `rx` arrondit les quatre coins : une barre posée sur l'axe
 * semble alors flotter au-dessus de lui. Seul le sommet doit être arrondi —
 * c'est le détail qui sépare un graphique dessiné d'un graphique par défaut.
 *
 * `up` inverse l'arrondi pour les valeurs négatives, qui pendent sous le zéro.
 */
export function barPath(
  x: number, y: number, w: number, h: number, r: number, up = true
): string {
  // Une barre plus courte que son rayon produirait une bosse au lieu d'une
  // barre : on plafonne l'arrondi à la demi-hauteur.
  const rr = Math.max(0, Math.min(r, w / 2, h));
  if (rr === 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;

  return up
    ? `M${x} ${y + h}V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}`
      + `H${x + w - rr}A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}V${y + h}Z`
    : `M${x} ${y}V${y + h - rr}A${rr} ${rr} 0 0 0 ${x + rr} ${y + h}`
      + `H${x + w - rr}A${rr} ${rr} 0 0 0 ${x + w} ${y + h - rr}V${y}Z`;
}
