import { UserRole } from "@/types";

/**
 * `approve` est une autorité distincte, pas un cas particulier de `update` :
 * un responsable qui n'a pas à corriger une note de frais doit pouvoir la
 * valider, et un comptable qui la corrige n'a pas forcément à l'approuver.
 * Les ressources qui ne la déclarent pas ne l'accordent à personne.
 */
type Action = "create" | "read" | "update" | "delete" | "approve";

interface ResourcePermissions {
  [resource: string]: Action[];
}

// ─── PME Roles ───────────────────────────────────────────────────────────────

const PME_ADMIN: ResourcePermissions = {
  expenses: ["create", "read", "update", "delete", "approve"],
  users: ["create", "read", "update", "delete"],
  companies: ["create", "read", "update", "delete"],
  clients: ["create", "read", "update", "delete"],
  suppliers: ["create", "read", "update", "delete"],
  products: ["create", "read", "update", "delete"],
  devis: ["create", "read", "update", "delete"],
  invoices: ["create", "read", "update", "delete"],
  deliveries: ["create", "read", "update", "delete"],
  livraisons: ["create", "read", "update", "delete"],
  commandes: ["create", "read", "update", "delete"],
  payments: ["create", "read", "update", "delete"],
  publicTenders: ["create", "read", "update", "delete"],
  contracts: ["create", "read", "update", "delete"],
  subscriptions: ["create", "read", "update", "delete"],
  projects: ["create", "read", "update", "delete"],
  employees: ["create", "read", "update", "delete"],
  payslips: ["create", "read", "update", "delete"],
  treasuryAccounts: ["create", "read", "update", "delete"],
  recurringCharges: ["create", "read", "update", "delete"],
  accountingEntries: ["create", "read", "update", "delete"],
  fiscalDeclarations: ["create", "read", "update", "delete"],
  fixedAssets: ["create", "read", "update", "delete"],
  documents: ["create", "read", "update", "delete"],
  approbations: ["create", "read", "update", "delete"],
  notifications: ["read", "update"],
  auditLogs: ["read"],
  supportTickets: ["create", "read", "update"],
};

const PME_MANAGER: ResourcePermissions = {
  expenses: ["create", "read", "update", "approve"],
  clients: ["create", "read", "update"],
  suppliers: ["create", "read", "update"],
  products: ["create", "read", "update"],
  devis: ["create", "read", "update"],
  invoices: ["create", "read", "update"],
  commandes: ["create", "read", "update"],
  payments: ["create", "read"],
  publicTenders: ["create", "read", "update"],
  contracts: ["create", "read", "update"],
  subscriptions: ["create", "read", "update"],
  projects: ["create", "read", "update"],
  employees: ["read"],
  treasuryAccounts: ["read"],
  accountingEntries: ["read"],
  documents: ["create", "read", "update"],
  approbations: ["read", "update"],
  notifications: ["read", "update"],
  auditLogs: ["read"],
  supportTickets: ["create", "read"],
};

const PME_ACCOUNTANT: ResourcePermissions = {
  expenses: ["create", "read", "update", "approve"],
  clients: ["read"],
  suppliers: ["read"],
  subscriptions: ["read"],
  invoices: ["read", "update"],
  payments: ["create", "read", "update"],
  treasuryAccounts: ["create", "read", "update", "delete"],
  recurringCharges: ["create", "read", "update", "delete"],
  accountingEntries: ["create", "read", "update", "delete"],
  fiscalDeclarations: ["create", "read", "update", "delete"],
  fixedAssets: ["create", "read", "update", "delete"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
  auditLogs: ["read"],
  supportTickets: ["create", "read"],
};

const PME_SALES: ResourcePermissions = {
  expenses: ["create", "read"],
  clients: ["create", "read", "update"],
  subscriptions: ["create", "read", "update"],
  products: ["read"],
  devis: ["create", "read", "update", "delete"],
  invoices: ["create", "read", "update"],
  payments: ["create", "read"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const PME_PURCHASES: ResourcePermissions = {
  expenses: ["create", "read"],
  suppliers: ["create", "read", "update"],
  subscriptions: ["create", "read", "update"],
  products: ["read", "update"],
  commandes: ["create", "read", "update", "delete"],
  publicTenders: ["create", "read", "update"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const PME_HR: ResourcePermissions = {
  expenses: ["create", "read"],
  employees: ["create", "read", "update", "delete"],
  payslips: ["create", "read", "update", "delete"],
  fiscalDeclarations: ["read"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const PME_PROJECT_MANAGER: ResourcePermissions = {
  expenses: ["create", "read"],
  clients: ["read"],
  projects: ["create", "read", "update", "delete"],
  contracts: ["create", "read", "update"],
  publicTenders: ["create", "read", "update"],
  documents: ["create", "read"],
  approbations: ["read"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const PME_APPROVER: ResourcePermissions = {
  expenses: ["read", "approve"],
  invoices: ["read"],
  commandes: ["read"],
  publicTenders: ["read"],
  contracts: ["read"],
  approbations: ["read", "update"],
  notifications: ["read", "update"],
};

const PME_VIEWER: ResourcePermissions = {
  expenses: ["read"],
  clients: ["read"],
  subscriptions: ["read"],
  suppliers: ["read"],
  products: ["read"],
  devis: ["read"],
  invoices: ["read"],
  commandes: ["read"],
  payments: ["read"],
  publicTenders: ["read"],
  contracts: ["read"],
  projects: ["read"],
  employees: ["read"],
  treasuryAccounts: ["read"],
  accountingEntries: ["read"],
  documents: ["read"],
  notifications: ["read"],
};

// ─── Associations Roles ───────────────────────────────────────────────────────

const ASSO_PRESIDENT: ResourcePermissions = {
  expenses: ["create", "read", "update", "delete", "approve"],
  users: ["create", "read", "update", "delete"],
  companies: ["read", "update"],
  membres: ["create", "read", "update", "delete"],
  bureau: ["create", "read", "update", "delete"],
  cotisations: ["create", "read", "update", "delete"],
  dons: ["create", "read", "update", "delete"],
  projects: ["create", "read", "update", "delete"],
  assemblee: ["create", "read", "update", "delete"],
  boardMeetings: ["create", "read", "update", "delete"],
  accountingEntries: ["create", "read", "update", "delete"],
  documents: ["create", "read", "update", "delete"],
  notifications: ["read", "update"],
  auditLogs: ["read"],
  supportTickets: ["create", "read"],
};

const ASSO_TREASURER: ResourcePermissions = {
  expenses: ["create", "read", "update", "approve"],
  membres: ["read"],
  cotisations: ["create", "read", "update", "delete"],
  dons: ["create", "read", "update", "delete"],
  accountingEntries: ["create", "read", "update", "delete"],
  treasuryAccounts: ["create", "read", "update", "delete"],
  fiscalDeclarations: ["create", "read", "update"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const ASSO_SECRETARY: ResourcePermissions = {
  expenses: ["create", "read"],
  membres: ["create", "read", "update", "delete"],
  bureau: ["create", "read", "update", "delete"],
  cotisations: ["read"],
  assemblee: ["create", "read", "update", "delete"],
  boardMeetings: ["create", "read", "update", "delete"],
  documents: ["create", "read", "update", "delete"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const ASSO_PROJECT_MANAGER: ResourcePermissions = {
  expenses: ["create", "read"],
  projects: ["create", "read", "update", "delete"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
};

const ASSO_MEMBER_PORTAL: ResourcePermissions = {
  membres: ["read"],
  cotisations: ["read"],
  assemblee: ["read"],
  documents: ["read"],
  notifications: ["read"],
};

// ─── Administration Roles ─────────────────────────────────────────────────────

const ADMIN_ORDONNATEUR: ResourcePermissions = {
  expenses: ["create", "read", "update", "delete", "approve"],
  users: ["read"],
  employees: ["create", "read", "update", "delete"],
  budgetChapters: ["create", "read", "update", "delete"],
  commitmentOrders: ["create", "read", "update", "delete"],
  paymentOrders: ["create", "read", "update", "delete"],
  publicTenders: ["read", "update"],
  publicRevenues: ["create", "read", "update", "delete"],
  // --- AJOUTE CETTE LIGNE ---
  services: ["create", "read", "update", "delete"], 
  // --------------------------
  documents: ["create", "read", "update"],
  notifications: ["read", "update"],
  auditLogs: ["read"],
};

const ADMIN_DAF: ResourcePermissions = {
  budgetChapters: ["create", "read", "update", "delete"],
  commitmentOrders: ["read"],
  paymentOrders: ["read"],
  publicTenders: ["read"],
  publicRevenues: ["create", "read", "update", "delete"],
  treasuryAccounts: ["create", "read", "update", "delete"],
  accountingEntries: ["create", "read", "update", "delete"],
  fiscalDeclarations: ["create", "read", "update"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
  auditLogs: ["read"],
  supportTickets: ["create", "read"],
};

const ADMIN_PUBLIC_ACCOUNTANT: ResourcePermissions = {
  // Le comptable public exécute les paiements contre le budget : il doit
  // pouvoir le consulter, sans le modifier.
  budgetChapters: ["read"],
  commitmentOrders: ["read", "update"],
  paymentOrders: ["create", "read", "update"],
  publicRevenues: ["create", "read", "update"],
  treasuryAccounts: ["read", "update"],
  accountingEntries: ["create", "read", "update"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
};

const ADMIN_PROCUREMENT_OFFICER: ResourcePermissions = {
  publicTenders: ["create", "read", "update", "delete"],
  suppliers: ["read"],
  budgetChapters: ["read"],
  commitmentOrders: ["read"],
  documents: ["create", "read", "update"],
  notifications: ["read", "update"],
};

const ADMIN_PROCUREMENT_COMMISSION: ResourcePermissions = {
  publicTenders: ["read", "update"],
  tenderBids: ["read", "update"],
  documents: ["read"],
  notifications: ["read", "update"],
};

const ADMIN_VIEWER: ResourcePermissions = {
  budgetChapters: ["read"],
  commitmentOrders: ["read"],
  paymentOrders: ["read"],
  publicTenders: ["read"],
  publicRevenues: ["read"],
  accountingEntries: ["read"],
  documents: ["read"],
  notifications: ["read"],
};

// ─── Superadmin ───────────────────────────────────────────────────────────────

const SUPERADMIN: ResourcePermissions = { "*": ["create", "read", "update", "delete"] };

// ─── Role Map ─────────────────────────────────────────────────────────────────

// ─── Rôle transversal ────────────────────────────────────────────────────────

/**
 * Chef de projet transversal
 * Peut gérer les projets sur tous les profils (PME, Associations, Administration)
 * Sans accès à la facturation, comptabilité, RH ni aux données financières
 */
/**
 * Responsable technique / intégrateur.
 *
 * Le profil qui manquait : la personne qui branche l'API, surveille les
 * journaux et diagnostique une panne n'a **aucune raison** de voir le chiffre
 * d'affaires, les salaires ou les impayés. Lui donner un rôle
 * d'administrateur « parce que c'est plus simple » revient à confier la paie à
 * l'informaticien.
 *
 * Il lit les journaux d'audit et les traces, gère les tickets, et voit la
 * liste des comptes — sans pouvoir en créer, en modifier le rôle, ni en
 * désactiver un seul.
 */
const TECH_ADMIN: ResourcePermissions = {
  auditLogs:     ["read"],
  supportTickets:["create", "read", "update"],
  notifications: ["read", "update"],
  documents:     ["read"],
  // Lecture seule : diagnostiquer un compte suppose de le voir, pas d'y toucher.
  users:         ["read"],
};

const CHEF_PROJET_TRANSVERSAL: ResourcePermissions = {
  projects:      ["create", "read", "update"],
  documents:     ["create", "read", "update"],
  approbations:  ["create", "read"],
  notifications: ["read", "update"],
  supportTickets:["create", "read"],
  // Lecture seule sur clients et membres (pour assigner au projet)
  clients:       ["read"],
  membres:       ["read"],
  employees:     ["read"],
};

const ROLE_PERMISSIONS: Record<UserRole, ResourcePermissions> = {
  // PME
  pme_admin: PME_ADMIN,
  pme_manager: PME_MANAGER,
  pme_accountant: PME_ACCOUNTANT,
  pme_sales: PME_SALES,
  pme_purchases: PME_PURCHASES,
  pme_hr: PME_HR,
  pme_project_manager: PME_PROJECT_MANAGER,
  pme_approver: PME_APPROVER,
  pme_viewer: PME_VIEWER,
  // Associations
  asso_president: ASSO_PRESIDENT,
  asso_treasurer: ASSO_TREASURER,
  asso_secretary: ASSO_SECRETARY,
  asso_project_manager: ASSO_PROJECT_MANAGER,
  asso_member_portal: ASSO_MEMBER_PORTAL,
  // Administration
  admin_ordonnateur: ADMIN_ORDONNATEUR,
  admin_daf: ADMIN_DAF,
  admin_public_accountant: ADMIN_PUBLIC_ACCOUNTANT,
  admin_procurement_officer: ADMIN_PROCUREMENT_OFFICER,
  admin_procurement_commission: ADMIN_PROCUREMENT_COMMISSION,
  admin_viewer: ADMIN_VIEWER,
  // Transversal
  chef_projet_transversal: CHEF_PROJET_TRANSVERSAL,
  tech_admin: TECH_ADMIN,
  // Plateforme
  superadmin: SUPERADMIN,
};

// ─── Module Activités (événements & billetterie) ─────────────────────────────
// Managers/admins créent et gèrent ; les autres rôles peuvent consulter.
// L'inscription d'un membre à une activité passe par des routes dédiées, pas
// par la permission CRUD "events".
const EVENTS_MANAGE: Action[] = ["create", "read", "update", "delete"];
const EVENTS_READ: Action[] = ["read"];
const EVENTS_BY_ROLE: Partial<Record<UserRole, Action[]>> = {
  pme_admin: EVENTS_MANAGE, pme_manager: EVENTS_MANAGE, pme_project_manager: EVENTS_MANAGE,
  pme_sales: EVENTS_READ, pme_accountant: EVENTS_READ, pme_hr: EVENTS_READ,
  pme_purchases: EVENTS_READ, pme_approver: EVENTS_READ, pme_viewer: EVENTS_READ,
  asso_president: EVENTS_MANAGE, asso_secretary: EVENTS_MANAGE, asso_treasurer: EVENTS_MANAGE,
  asso_project_manager: EVENTS_MANAGE, asso_member_portal: EVENTS_READ,
  admin_ordonnateur: EVENTS_MANAGE, admin_daf: EVENTS_MANAGE,
  admin_public_accountant: EVENTS_READ, admin_procurement_officer: EVENTS_READ,
  admin_procurement_commission: EVENTS_READ, admin_viewer: EVENTS_READ,
  chef_projet_transversal: EVENTS_MANAGE,
};
for (const [role, actions] of Object.entries(EVENTS_BY_ROLE)) {
  const perms = ROLE_PERMISSIONS[role as UserRole];
  if (perms) perms.events = actions;
}

/**
 * Agenda : universel. Chaque collaborateur gère son propre agenda et voit les
 * agendas partagés de l'organisation, indépendamment de ses droits métier.
 * L'API borne ensuite la portée (on ne modifie que ses propres entrées).
 */
const AGENDA_ALL: Action[] = ["create", "read", "update", "delete"];
for (const perms of Object.values(ROLE_PERMISSIONS)) {
  perms.agenda = AGENDA_ALL;
}

/**
 * Messagerie : universelle, comme l'agenda. Sans cette autorisation, la
 * ressource « messages » n'était accordée à aucun rôle et toute l'API de
 * messagerie répondait 403. La portée reste bornée par l'API (on ne voit que
 * les conversations où l'on est participant).
 */
const MESSAGES_ALL: Action[] = ["create", "read", "update", "delete"];
for (const perms of Object.values(ROLE_PERMISSIONS)) {
  perms.messages = MESSAGES_ALL;
}

/** Module ISIC (production de cartes) : accordé largement, borné par le tenant. */
const ISIC_ALL: Action[] = ["create", "read", "update", "delete"];
for (const perms of Object.values(ROLE_PERMISSIONS)) {
  perms.isic = ISIC_ALL;
}

/**
 * `allowedResources` **restreint**, il n'accorde jamais.
 *
 * Ce champ est modifiable par un administrateur de tenant ; s'il pouvait
 * accorder une ressource absente du rôle, il deviendrait un moyen d'élévation
 * de privilèges (un pme_admin s'octroyant les droits superadmin). La règle est
 * donc l'intersection : le rôle borne le maximum, la liste réduit à l'intérieur
 * de cette borne.
 */
function withinAllowList(resource: string, allowedResources?: string[]): boolean {
  if (!allowedResources || allowedResources.length === 0) return true;
  return allowedResources.includes(resource) || allowedResources.includes("*");
}

/**
 * Vérifie si un rôle peut accéder à une ressource.
 */
export function canAccessResource(
  role: UserRole,
  resource: string,
  allowedResources?: string[]
): boolean {
  if (role === "superadmin") return true;
  if (!withinAllowList(resource, allowedResources)) return false;

  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  if (permissions["*"]) return true;

  return resource in permissions;
}

/**
 * Vérifie si un rôle peut effectuer une action CRUD sur une ressource.
 *
 * `allowedResources` est pris en compte ici aussi : les deux fonctions doivent
 * répondre la même chose, sans quoi l'interface affiche ce que l'API refuse.
 */
export function canPerformAction(
  role: UserRole,
  resource: string,
  action: Action,
  allowedResources?: string[]
): boolean {
  if (role === "superadmin") return true;
  if (!withinAllowList(resource, allowedResources)) return false;

  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  if (permissions["*"]) return true;

  const actions = permissions[resource];
  return actions?.includes(action) ?? false;
}

/**
 * Retourne les ressources accessibles par un rôle, éventuellement réduites par
 * la liste individuelle.
 */
export function getAccessibleResources(role: UserRole, allowedResources?: string[]): string[] {
  if (role === "superadmin") return ["*"];
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return [];
  return Object.keys(permissions).filter(r => withinAllowList(r, allowedResources));
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-rôle — un collaborateur peut cumuler plusieurs rôles (comptable + RH +
// achats, courant dans une petite structure). Les permissions s'évaluent alors
// en UNION : l'action est autorisée si AU MOINS UN des rôles la permet. Les
// versions à rôle unique restent le cas particulier `[role]`, si bien que rien
// ne change pour un compte mono-rôle.
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise en tableau non vide : `roles` s'il est fourni, sinon `[role]`. */
export function effectiveRoles(role: UserRole, roles?: UserRole[] | null): UserRole[] {
  return roles && roles.length > 0 ? roles : [role];
}

export function rolesCanPerform(
  roles: UserRole[], resource: string, action: Action, allowedResources?: string[]
): boolean {
  return roles.some(r => canPerformAction(r, resource, action, allowedResources));
}

export function rolesCanAccess(
  roles: UserRole[], resource: string, allowedResources?: string[]
): boolean {
  return roles.some(r => canAccessResource(r, resource, allowedResources));
}

/** Union des ressources accessibles par l'ensemble des rôles. */
export function accessibleResourcesForRoles(roles: UserRole[], allowedResources?: string[]): string[] {
  if (roles.includes("superadmin")) return ["*"];
  const set = new Set<string>();
  for (const role of roles) {
    for (const r of getAccessibleResources(role, allowedResources)) set.add(r);
  }
  return [...set];
}

export {
  ROLE_PERMISSIONS,
  CHEF_PROJET_TRANSVERSAL,
};
