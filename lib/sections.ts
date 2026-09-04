/**
 * Accents de section.
 *
 * Chaque grand domaine de l'application porte sa propre teinte. Ce n'est pas de
 * la décoration : dans un ERP où les écrans se ressemblent — une liste, un
 * formulaire, un tableau —, la couleur dit en un coup d'œil dans quelle partie
 * du produit on se trouve, et la mémoire visuelle fait le reste.
 *
 * Une seule table de correspondance, consommée par la barre latérale (item
 * actif), la coque (attribut `data-section`) et les graphiques (variable
 * `--s-accent`). Deux définitions divergentes produiraient une barre latérale
 * d'une couleur et un contenu d'une autre.
 */

export type SectionKey =
  | "accueil"
  | "ventes"
  | "achats"
  | "abonnements"
  | "contrats"
  | "finance"
  | "rh"
  | "gouvernance"
  | "membres"
  | "budget"
  | "parametres"
  | "plateforme";

export interface SectionMeta {
  key: SectionKey;
  /** Libellé affiché dans le fil d'ariane. */
  label: string;
}

export const SECTIONS: Record<SectionKey, SectionMeta> = {
  accueil:     { key: "accueil",     label: "Accueil" },
  ventes:      { key: "ventes",      label: "Ventes" },
  achats:      { key: "achats",      label: "Achats & Stock" },
  abonnements: { key: "abonnements", label: "Abonnements" },
  contrats:    { key: "contrats",    label: "Contrats & Projets" },
  finance:     { key: "finance",     label: "Finance" },
  rh:          { key: "rh",          label: "Ressources humaines" },
  gouvernance: { key: "gouvernance", label: "Gouvernance" },
  membres:     { key: "membres",     label: "Membres" },
  budget:      { key: "budget",      label: "Budget public" },
  parametres:  { key: "parametres",  label: "Paramètres" },
  plateforme:  { key: "plateforme",  label: "Plateforme" },
};

/**
 * Préfixes de route → section. L'ordre compte : le premier préfixe qui
 * correspond gagne, donc les chemins les plus spécifiques d'abord.
 */
const ROUTE_SECTIONS: Array<[string, SectionKey]> = [
  // Abonnements — revente incluse
  ["/abonnements", "abonnements"],

  // Ventes
  ["/clients", "ventes"],
  ["/devis", "ventes"],
  ["/invoices", "ventes"],
  ["/livraisons", "ventes"],
  ["/payments", "ventes"],
  ["/relances", "ventes"],
  ["/crm", "ventes"],

  // Achats & stock
  ["/suppliers", "achats"],
  ["/commandes", "achats"],
  ["/stock", "achats"],
  ["/inventaires", "achats"],
  ["/marches", "achats"],

  // Contrats & projets
  ["/contracts", "contrats"],
  ["/projects", "contrats"],
  ["/documents-administratifs", "contrats"],
  ["/documents", "contrats"],
  ["/approbations", "contrats"],

  // Finance
  ["/treasury", "finance"],
  ["/notes-de-frais", "finance"],
  ["/accounting", "finance"],
  ["/budget-previsionnel", "finance"],
  ["/recurring-expenses", "finance"],
  ["/fiscalite", "finance"],
  ["/fixed-assets", "finance"],
  ["/analytics", "finance"],

  // RH
  ["/employees", "rh"],
  ["/payslips", "rh"],

  // Associations
  ["/associations/bureau", "gouvernance"],
  ["/associations/assemblee", "gouvernance"],
  ["/associations/membres", "membres"],
  ["/associations/cotisations", "membres"],
  ["/associations/dons", "membres"],
  // Ces deux préfixes ne servent plus qu'aux redirections : les écrans ont été
  // unifiés sous /projects et /documents (voir lib/vocabulary.ts).
  ["/associations/projets", "contrats"],
  ["/associations/documents", "contrats"],
  ["/associations/dashboard", "accueil"],
  ["/associations/profil", "parametres"],

  // Administration
  ["/administration/budget", "budget"],
  ["/administration/recettes", "budget"],
  ["/administration/marches-publics", "achats"],
  ["/administration/projets", "contrats"],
  ["/administration/personnel", "rh"],
  ["/administration/services", "parametres"],
  ["/administration/dashboard", "accueil"],

  // Plateforme (superadmin)
  ["/saas", "plateforme"],

  // Paramètres
  ["/settings", "parametres"],
  ["/users", "parametres"],
  ["/subscription", "parametres"],
  ["/support", "parametres"],
  ["/audit", "parametres"],

  // Accueil
  ["/dashboard", "accueil"],
  ["/activites", "accueil"],
  ["/notifications", "accueil"],
  ["/messages", "accueil"],
  ["/courriers", "accueil"],
];

/** Section d'un chemin. `accueil` par défaut, jamais `undefined`. */
export function sectionForPath(pathname: string): SectionKey {
  for (const [prefix, key] of ROUTE_SECTIONS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  }
  return "accueil";
}
