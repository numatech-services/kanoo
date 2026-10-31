/**
 * Modules optionnels : des métiers propres à certaines organisations (un point
 * de vente, la distribution de cartes ISIC, la revente de licences, la
 * billetterie d'événements). Une organisation qui ne les exerce pas n'a pas à
 * les voir dans son menu.
 *
 * Tout est actif par défaut : l'organisation désactive ce qu'elle n'utilise
 * pas (Réglages › Modules). C'est un choix d'affichage — menu et recherche —,
 * pas une barrière de sécurité : les droits restent portés par les rôles.
 */

export type ModuleKey = "comptoir" | "isic" | "licences" | "evenements";

export interface ModuleMeta {
  key: ModuleKey;
  label: string;
  description: string;
  /** Préfixes d'écran rattachés au module. */
  hrefs: string[];
}

export const OPTIONAL_MODULES: ModuleMeta[] = [
  { key: "comptoir", label: "Restauration et comptoirs", hrefs: ["/comptoir", "/restauration"],
    description: "Restaurants et points de vente (bar, boutique, buvette) : caisse, stock en réserve et au comptoir, inventaires, prix et marges, équipe, résultat." },
  { key: "isic", label: "Cartes ISIC", hrefs: ["/isic"],
    description: "Lots de cartes étudiantes, registre des étudiants, licences annuelles et coûts d'impression." },
  { key: "licences", label: "Revente de licences", hrefs: ["/abonnements"],
    description: "Contrats souscrits auprès d'éditeurs et reventes à vos clients, avec la marge de chaque licence." },
  { key: "evenements", label: "Événements", hrefs: ["/activites"],
    description: "Billetterie, inscriptions, caisse et stock d'un événement ou d'une activité." },
];

export const MODULE_KEYS = OPTIONAL_MODULES.map(m => m.key);

/** Module dont relève un lien, ou `undefined` pour un écran du socle. */
export function moduleForHref(href: string): ModuleKey | undefined {
  const path = href.split("?")[0];
  return OPTIONAL_MODULES.find(m => m.hrefs.some(p => path === p || path.startsWith(`${p}/`)))?.key;
}

/** Le lien est-il visible compte tenu des modules désactivés ? */
export function moduleEnabled(href: string, disabled: readonly string[] | undefined): boolean {
  const key = moduleForHref(href);
  return !key || !disabled?.includes(key);
}

/** Ne garde que des clés connues, sans doublon. */
export function sanitizeModules(input: unknown): ModuleKey[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((k): k is ModuleKey => MODULE_KEYS.includes(k as ModuleKey)))];
}
