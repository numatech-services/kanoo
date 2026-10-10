import type { UserRole } from "@/types";

/**
 * Les rôles, décrits pour un humain qui doit choisir.
 *
 * L'écran affichait `pme_project_manager` avec les tirets bas remplacés par des
 * espaces. Choisir entre « pme approver » et « pme manager » sur cette seule
 * base revient à tirer au sort — et une erreur de rôle ouvre ou ferme l'accès
 * à la paie.
 *
 * Chaque entrée dit **ce que le rôle permet** et, quand cela compte, ce qu'il
 * interdit : c'est l'information qui manque au moment du choix.
 */
export interface RoleDescription {
  label: string;
  summary: string;
  /** Ce que le rôle ne peut pas faire, quand l'omettre induirait en erreur. */
  cannot?: string;
  group: "Direction" | "Finance" | "Opérations" | "Ressources humaines" | "Technique" | "Consultation" | "Services";
  /** Ancien rôle : conservé pour les comptes existants, plus proposé à l'attribution. */
  legacy?: boolean;
}

/** Libellés des niveaux (par rôle de service). */
export const LEVEL_UI: Record<"chef" | "employe" | "stagiaire", { label: string; summary: string }> = {
  chef: { label: "Chef de service", summary: "Tout dans son service, y compris supprimer et valider (notes de frais de l'équipe)." },
  employe: { label: "Employé", summary: "Consulte, crée et modifie ; ne supprime pas et ne valide pas." },
  stagiaire: { label: "Stagiaire", summary: "Consulte, crée et modifie ; ni suppression, ni validation, ni export. Accès fermé à la fin du stage." },
};

export const ROLE_UI: Partial<Record<UserRole, RoleDescription>> = {
  // ── PME ────────────────────────────────────────────────────────────────
  pme_admin: {
    label: "Gérant",
    summary: "Administrateur principal : tous les droits, dont les finances, les comptes et les rôles.",
    group: "Direction",
  },
  // ── Services (organisation cloisonnée) ────────────────────────────────
  svc_admin: {
    label: "Service Administration",
    summary: "Vente de matériel et mobilier, achats, stock, bons de livraison, appels d'offres, dossiers du personnel (sans salaires).",
    cannot: "Aucune information financière : factures, encaissements, comptabilité, salaires.",
    group: "Services",
  },
  svc_comm: {
    label: "Service Communication",
    summary: "Projets de communication (interne et clients), devis, documents, courriers, événements.",
    cannot: "Aucune information financière.",
    group: "Services",
  },
  svc_prosp: {
    label: "Service Prospection",
    summary: "Prospects et CRM, devis, veille et candidatures aux appels d'offres.",
    cannot: "Aucune information financière.",
    group: "Services",
  },
  svc_dev: {
    label: "Service Développement logiciel",
    summary: "Projets, abonnements et licences (sans montants), support et intégration technique.",
    cannot: "Aucune information financière.",
    group: "Services",
  },
  svc_prod: {
    label: "Service Production & Cartes",
    summary: "Production, cartes ISIC et Easypay : registre, numéros, photos, lots, envoi à ISIC.",
    cannot: "Ne voit ni les coûts ni les marges des cartes.",
    group: "Services",
  },
  svc_spot: {
    label: "Service The Spot",
    summary: "Restauration multi-site : stock matière et saisie de caisse des sites attribués (le chef voit tous les sites).",
    cannot: "Ne voit ni la rentabilité ni les finances de l'entreprise.",
    group: "Services",
  },
  svc_secu: {
    label: "Service Sécurité",
    summary: "Contrôle des accès physiques : consignes et documents en lecture, contrôle des billets à l'entrée des événements.",
    cannot: "Accès minimal : aucune donnée commerciale ni financière.",
    group: "Services",
  },
  svc_compta: {
    label: "Service Comptabilité",
    summary: "Factures, encaissements, trésorerie, comptabilité, fiscalité, rentabilité par activité, remboursement des notes de frais.",
    cannot: "La paie est réservée au chef comptable.",
    group: "Finance",
  },
  pme_manager: {
    label: "Responsable",
    summary: "Ventes, achats, projets, trésorerie et validation des notes de frais.",
    cannot: "Ne gère ni les comptes utilisateurs ni la paie.",
    group: "Direction",
    legacy: true,
  },
  pme_accountant: {
    label: "Comptable",
    summary: "Comptabilité, trésorerie, fiscalité, rapprochement bancaire, notes de frais ; consultation du stock.",
    cannot: "Ne crée pas de compte utilisateur.",
    group: "Finance",
    legacy: true,
  },
  pme_approver: {
    label: "Approbateur",
    summary: "Valide les notes de frais et les demandes soumises à approbation.",
    cannot: "Ne saisit ni ne modifie les pièces qu'il valide.",
    group: "Finance",
    legacy: true,
  },
  pme_sales: {
    label: "Commercial",
    summary: "Clients, devis, factures, livraisons.",
    cannot: "N'accède ni à la comptabilité ni à la paie.",
    group: "Opérations",
    legacy: true,
  },
  pme_purchases: {
    label: "Achats & stock",
    summary: "Fournisseurs, commandes, réceptions, stock : création d'articles, entrées et inventaires.",
    cannot: "N'accède pas aux ventes ni à la paie.",
    group: "Opérations",
    legacy: true,
  },
  pme_project_manager: {
    label: "Chef de projet",
    summary: "Projets, tâches, documents, suivi budgétaire du projet.",
    cannot: "Ne facture pas.",
    group: "Opérations",
    legacy: true,
  },
  pme_hr: {
    label: "Ressources humaines",
    summary: "Salariés, contrats, bulletins de paie, CNSS et IR.",
    cannot: "N'accède ni aux ventes ni à la comptabilité générale.",
    group: "Ressources humaines",
    legacy: true,
  },
  pme_viewer: {
    label: "Lecture seule",
    summary: "Consulte sans jamais modifier.",
    group: "Consultation",
    legacy: true,
  },
  pme_isic_operator: {
    label: "Opérateur ISIC",
    summary: "Cartes ISIC : traitement, impression et livraison — sans les montants.",
    group: "Opérations",
    legacy: true,
  },
  pme_isic_finance: {
    label: "Financier ISIC",
    summary: "Cartes ISIC : coûts, revente, marge et encaissements.",
    group: "Finance",
    legacy: true,
  },
  pme_activity_manager: {
    label: "Gestionnaire d'activité (The Spot)",
    summary: "Comptoir d'activité : stock matière (entrées/sorties) et caisse (recettes/dépenses).",
    cannot: "N'accède pas au reste de la comptabilité, aux ventes ni à la paie.",
    group: "Opérations",
    legacy: true,
  },

  // ── Associations ───────────────────────────────────────────────────────
  asso_president: {
    label: "Président·e",
    summary: "Tous les droits, y compris la gestion des comptes.",
    group: "Direction",
  },
  asso_treasurer: {
    label: "Trésorier·ère",
    summary: "Cotisations, dons, trésorerie, comptabilité, notes de frais.",
    group: "Finance",
  },
  asso_secretary: {
    label: "Secrétaire",
    summary: "Membres, assemblées, procès-verbaux, convocations, activités.",
    cannot: "N'accède pas à la trésorerie.",
    group: "Opérations",
  },
  asso_project_manager: {
    label: "Responsable de projet",
    summary: "Projets, activités, documents, rapports bailleurs.",
    group: "Opérations",
  },
  asso_member_portal: {
    label: "Accès portail adhérent",
    summary: "Ne voit que son propre espace : reçus, cotisations, convocations.",
    cannot: "N'accède à aucune donnée de l'association.",
    group: "Consultation",
  },

  // ── Administrations ────────────────────────────────────────────────────
  admin_ordonnateur: {
    label: "Ordonnateur",
    summary: "Engage la dépense, mandate, gère les comptes et les rôles.",
    group: "Direction",
  },
  admin_daf: {
    label: "Directeur·rice financier·ère",
    summary: "Budget, engagements, mandats, comptabilité publique.",
    group: "Finance",
  },
  admin_public_accountant: {
    label: "Comptable public",
    summary: "Paiement des mandats, recettes, écritures.",
    cannot: "N'engage pas la dépense — la séparation ordonnateur/comptable est le principe même du contrôle.",
    group: "Finance",
  },
  admin_procurement_officer: {
    label: "Chargé des marchés",
    summary: "Appels d'offres, dossiers de consultation, portail fournisseur.",
    group: "Opérations",
  },
  admin_procurement_commission: {
    label: "Membre de commission",
    summary: "Consulte les offres et participe aux décisions d'attribution.",
    cannot: "Ne modifie ni les dossiers ni les offres déposées.",
    group: "Consultation",
  },
  admin_viewer: {
    label: "Lecture seule",
    summary: "Consulte sans jamais modifier.",
    group: "Consultation",
  },

  // ── Transversaux ───────────────────────────────────────────────────────
  chef_projet_transversal: {
    label: "Chef de projet transversal",
    summary: "Projets et documents, quel que soit le profil de l'organisation.",
    cannot: "Ne facture pas et n'accède pas à la comptabilité.",
    group: "Opérations",
  },
  tech_admin: {
    label: "Responsable technique",
    summary: "Journaux d'audit, tickets de support, diagnostic. Voit la liste des comptes.",
    cannot: "N'accède à aucune donnée financière, et ne modifie aucun compte.",
    group: "Technique",
  },
};

/** Rôles proposés à la création, par type d'organisation. */
export const ASSIGNABLE_BY_TENANT: Record<string, UserRole[]> = {
  // Organisation cloisonnée : le gérant et les services. Les anciens rôles PME
  // restent valables pour les comptes existants mais ne sont plus proposés.
  pme: [
    "pme_admin",
    "svc_admin", "svc_comm", "svc_prosp", "svc_dev", "svc_prod", "svc_spot", "svc_secu", "svc_compta",
  ],
  association: [
    "asso_president", "asso_treasurer", "asso_secretary",
    "asso_project_manager", "asso_member_portal",
    "chef_projet_transversal", "tech_admin",
  ],
  administration: [
    "admin_ordonnateur", "admin_daf", "admin_public_accountant",
    "admin_procurement_officer", "admin_procurement_commission",
    "admin_viewer", "chef_projet_transversal", "tech_admin",
  ],
};

/**
 * Rôles qu'un appelant peut attribuer : ceux de son type d'organisation, ou
 * tous (y compris superadmin) pour le superadmin. Utilisé par l'API à la
 * création ET à la modification d'un compte.
 */
export function assignableRoles(auth: { role: string; tenantType?: string }): string[] {
  if (auth.role === "superadmin") {
    return [...new Set([...ASSIGNABLE_BY_TENANT.pme, ...ASSIGNABLE_BY_TENANT.association, ...ASSIGNABLE_BY_TENANT.administration, "superadmin"])];
  }
  return ASSIGNABLE_BY_TENANT[auth.tenantType ?? ""] ?? [];
}

/** Rôles capables d'administrer une organisation. */
export const TENANT_ADMIN_ROLES: UserRole[] = [
  "pme_admin", "asso_president", "admin_ordonnateur", "superadmin",
];

export function roleLabel(role: string): string {
  return ROLE_UI[role as UserRole]?.label ?? role.replace(/_/g, " ");
}

export function isTenantAdmin(role: string): boolean {
  return TENANT_ADMIN_ROLES.includes(role as UserRole);
}

/**
 * Administrateur d'organisation, sur TOUS ses rôles cumulés : le rôle principal
 * seul (`role`) laissait un gérant multi-rôle sans droits d'administration
 * dès que « gérant » n'était pas le premier de sa liste.
 */
export function hasTenantAdminRole(u: { role?: string; roles?: string[] | null }): boolean {
  const list = u.roles && u.roles.length > 0 ? u.roles : u.role ? [u.role] : [];
  return list.some(isTenantAdmin);
}

/** Filtre MongoDB des comptes administrateurs (rôle principal ou cumulé). */
export const TENANT_ADMIN_QUERY = { $or: [{ role: { $in: TENANT_ADMIN_ROLES } }, { roles: { $in: TENANT_ADMIN_ROLES } }] };
