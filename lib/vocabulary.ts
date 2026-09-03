import type { TenantType } from "@/types";

/**
 * Vocabulaire métier par profil.
 *
 * Un projet d'ONG, un projet d'entreprise et un projet d'administration sont la
 * même chose dans la base : même modèle, même route, même cycle de vie. Ce qui
 * change, c'est le mot — « bailleur » ici, « maître d'ouvrage » là, « client »
 * ailleurs.
 *
 * Jusqu'ici cette différence de vocabulaire était traitée en dupliquant les
 * écrans : neuf pages pour un module, 1 239 lignes à maintenir en triple, et
 * trois endroits où corriger le même défaut — ce qui veut dire deux endroits
 * oubliés. Le vocabulaire vit désormais ici, et l'écran est unique.
 *
 * Conséquence utile au passage : les trois profils héritent du meilleur écran
 * des trois. La fiche projet d'une PME faisait 105 lignes sans tâches ni
 * documents, contre 454 côté associations, pour exactement les mêmes données.
 */

export interface ProjectVocabulary {
  /** Titre de l'écran de liste. */
  plural: string;
  singular: string;
  /** Celui qui finance. */
  funder: string;
  /** Ceux qui travaillent dessus. */
  team: string;
  /**
   * Route d'où proviennent les personnes assignables. C'est la seule
   * différence de comportement, pas seulement de mot : une association assigne
   * des membres du bureau, une entreprise des collaborateurs.
   */
  teamEndpoint: string;
  /** Libellé du bouton de création. */
  createLabel: string;
  /** Type de projet écrit en base — le discriminant existant. */
  projectType: string;
}

const PME: ProjectVocabulary = {
  plural: "Projets",
  singular: "Projet",
  funder: "Client",
  team: "Équipe",
  teamEndpoint: "/api/employees",
  createLabel: "Nouveau projet",
  projectType: "internal",
};

const ASSOCIATION: ProjectVocabulary = {
  plural: "Projets & programmes",
  singular: "Projet",
  funder: "Bailleur",
  team: "Intervenants",
  teamEndpoint: "/api/bureau",
  createLabel: "Nouveau projet",
  projectType: "ong",
};

const ADMINISTRATION: ProjectVocabulary = {
  plural: "Projets publics",
  singular: "Projet",
  funder: "Maître d'ouvrage",
  team: "Agents affectés",
  teamEndpoint: "/api/employees",
  createLabel: "Nouveau projet",
  projectType: "public",
};

const BY_PROFILE: Record<string, ProjectVocabulary> = {
  pme: PME,
  association: ASSOCIATION,
  administration: ADMINISTRATION,
  // Le superadmin voit les données d'un tenant : on prend le vocabulaire le
  // plus neutre plutôt que d'inventer un quatrième jeu de termes.
  superadmin: PME,
};

export function projectVocabulary(profile: TenantType | "superadmin" | string): ProjectVocabulary {
  return BY_PROFILE[profile] ?? PME;
}

/** Libellés d'état, communs aux trois profils. */
export const PROJECT_STATUS_FR: Record<string, string> = {
  planning: "Planification",
  active: "En cours",
  on_hold: "En pause",
  completed: "Terminé",
  cancelled: "Annulé",
};

/** Libellés d'état des tâches. */
export const TASK_STATUS_FR: Record<string, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminé",
  blocked: "Bloqué",
};
