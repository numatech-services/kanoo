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
  group: "Direction" | "Finance" | "Opérations" | "Ressources humaines" | "Technique" | "Consultation";
}

export const ROLE_UI: Partial<Record<UserRole, RoleDescription>> = {
  // ── PME ────────────────────────────────────────────────────────────────
  pme_admin: {
    label: "Administrateur",
    summary: "Tous les droits, y compris la gestion des comptes et des rôles.",
    group: "Direction",
  },
  pme_manager: {
    label: "Responsable",
    summary: "Ventes, achats, projets, trésorerie et validation des notes de frais.",
    cannot: "Ne gère ni les comptes utilisateurs ni la paie.",
    group: "Direction",
  },
  pme_accountant: {
    label: "Comptable",
    summary: "Comptabilité, trésorerie, fiscalité, rapprochement bancaire, notes de frais ; consultation du stock.",
    cannot: "Ne crée pas de compte utilisateur.",
    group: "Finance",
  },
  pme_approver: {
    label: "Approbateur",
    summary: "Valide les notes de frais et les demandes soumises à approbation.",
    cannot: "Ne saisit ni ne modifie les pièces qu'il valide.",
    group: "Finance",
  },
  pme_sales: {
    label: "Commercial",
    summary: "Clients, devis, factures, livraisons.",
    cannot: "N'accède ni à la comptabilité ni à la paie.",
    group: "Opérations",
  },
  pme_purchases: {
    label: "Achats & stock",
    summary: "Fournisseurs, commandes, réceptions, stock : création d'articles, entrées et inventaires.",
    cannot: "N'accède pas aux ventes ni à la paie.",
    group: "Opérations",
  },
  pme_project_manager: {
    label: "Chef de projet",
    summary: "Projets, tâches, documents, suivi budgétaire du projet.",
    cannot: "Ne facture pas.",
    group: "Opérations",
  },
  pme_hr: {
    label: "Ressources humaines",
    summary: "Salariés, contrats, bulletins de paie, CNSS et IR.",
    cannot: "N'accède ni aux ventes ni à la comptabilité générale.",
    group: "Ressources humaines",
  },
  pme_viewer: {
    label: "Lecture seule",
    summary: "Consulte sans jamais modifier.",
    group: "Consultation",
  },
  pme_isic_operator: {
    label: "Opérateur ISIC",
    summary: "Cartes ISIC : traitement, impression et livraison — sans les montants.",
    group: "Opérations",
  },
  pme_isic_finance: {
    label: "Financier ISIC",
    summary: "Cartes ISIC : coûts, revente, marge et encaissements.",
    group: "Finance",
  },
  pme_activity_manager: {
    label: "Gestionnaire d'activité (The Spot)",
    summary: "Comptoir d'activité : stock matière (entrées/sorties) et caisse (recettes/dépenses).",
    cannot: "N'accède pas au reste de la comptabilité, aux ventes ni à la paie.",
    group: "Opérations",
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
  pme: [
    "pme_admin", "pme_manager", "pme_accountant", "pme_approver",
    "pme_sales", "pme_purchases", "pme_project_manager", "pme_hr",
    "pme_isic_operator", "pme_isic_finance", "pme_activity_manager",
    "pme_viewer", "chef_projet_transversal", "tech_admin",
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
