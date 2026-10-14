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
  | "documents"
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
  accueil:     { key: "accueil",     label: "Pilotage" },
  ventes:      { key: "ventes",      label: "Ventes" },
  achats:      { key: "achats",      label: "Achats & stock" },
  abonnements: { key: "abonnements", label: "Modules" },
  contrats:    { key: "contrats",    label: "Appels d'offres & projets" },
  documents:   { key: "documents",   label: "Documents" },
  finance:     { key: "finance",     label: "Finance" },
  rh:          { key: "rh",          label: "Équipe" },
  gouvernance: { key: "gouvernance", label: "Gouvernance" },
  membres:     { key: "membres",     label: "Membres" },
  budget:      { key: "budget",      label: "Budget public" },
  parametres:  { key: "parametres",  label: "Réglages" },
  plateforme:  { key: "plateforme",  label: "Plateforme" },
};

/**
 * Préfixes de route → section. L'ordre compte : le premier préfixe qui
 * correspond gagne, donc les chemins les plus spécifiques d'abord.
 */
const ROUTE_SECTIONS: Array<[string, SectionKey]> = [
  // Modules optionnels (comptoirs, ISIC, revente de licences, événements)
  ["/abonnements", "abonnements"],
  ["/comptoir", "abonnements"],
  ["/isic", "abonnements"],
  ["/activites", "abonnements"],

  // Ventes — du prospect à l'encaissement
  ["/clients", "ventes"],
  ["/crm", "ventes"],
  ["/devis", "ventes"],
  ["/contracts", "ventes"],
  ["/marches-cadres", "ventes"],
  ["/invoices", "ventes"],
  ["/livraisons", "ventes"],
  ["/payments", "ventes"],
  ["/relances", "ventes"],

  // Achats & stock
  ["/suppliers", "achats"],
  ["/commandes", "achats"],
  ["/depenses", "achats"],
  ["/recurring-expenses", "achats"],
  ["/stock", "achats"],
  ["/inventaires", "achats"],
  ["/marches", "contrats"],

  // Appels d'offres & projets
  ["/appels", "contrats"],
  ["/cautions", "contrats"],
  ["/projects", "contrats"],
  ["/approbations", "contrats"],

  // Documents
  ["/documents-administratifs", "documents"],
  ["/documents", "documents"],
  ["/courriers", "documents"],

  // Finance
  ["/treasury", "finance"],
  ["/accounting", "finance"],
  ["/fiscalite", "finance"],
  ["/budget-previsionnel", "finance"],
  ["/fixed-assets", "finance"],
  ["/analytique", "finance"],
  ["/analytics", "finance"],

  // Équipe
  ["/employees", "rh"],
  ["/payslips", "rh"],
  ["/conges", "rh"],
  ["/notes-de-frais", "rh"],

  // Associations
  ["/associations/bureau", "gouvernance"],
  ["/associations/assemblee", "gouvernance"],
  ["/associations/membres", "membres"],
  ["/associations/cotisations", "membres"],
  ["/associations/dons", "membres"],
  // Ces deux préfixes ne servent plus qu'aux redirections : les écrans ont été
  // unifiés sous /projects et /documents (voir lib/vocabulary.ts).
  ["/associations/projets", "contrats"],
  ["/associations/documents", "documents"],
  ["/associations/dashboard", "accueil"],
  ["/associations/agenda", "accueil"],
  ["/associations/profil", "parametres"],

  // Administration
  ["/administration/budget", "budget"],
  ["/administration/recettes", "budget"],
  ["/administration/marches-publics", "achats"],
  ["/administration/projets", "contrats"],
  ["/administration/personnel", "rh"],
  ["/administration/services", "parametres"],
  ["/administration/dashboard", "accueil"],
  ["/administration/agenda", "accueil"],

  // Plateforme (superadmin)
  ["/saas", "plateforme"],

  // Réglages
  ["/settings", "parametres"],
  ["/company", "parametres"],
  ["/users", "parametres"],
  ["/data", "parametres"],
  ["/subscription", "parametres"],
  ["/support", "parametres"],
  ["/audit", "parametres"],
  ["/profile", "parametres"],

  // Pilotage
  ["/dashboard", "accueil"],
  ["/rapports", "accueil"],
  ["/agenda", "accueil"],
  ["/notifications", "accueil"],
  ["/messages", "accueil"],
];

/** Section d'un chemin. `accueil` par défaut, jamais `undefined`. */
export function sectionForPath(pathname: string): SectionKey {
  for (const [prefix, key] of ROUTE_SECTIONS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  }
  return "accueil";
}
