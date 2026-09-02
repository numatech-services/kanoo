import { UserRole } from "@/types";

type Action = "create" | "read" | "update" | "delete";

interface ResourcePermissions {
  [resource: string]: Action[];
}

// ─── PME Roles ───────────────────────────────────────────────────────────────

const PME_ADMIN: ResourcePermissions = {
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
  publicTenders: ["create", "read", "update", "delete"], // Remplace 'marches' par 'publicTenders'
  contracts: ["create", "read", "update", "delete"],
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
  clients: ["create", "read", "update"],
  suppliers: ["create", "read", "update"],
  products: ["create", "read", "update"],
  devis: ["create", "read", "update"],
  invoices: ["create", "read", "update"],
  commandes: ["create", "read", "update"],
  payments: ["create", "read"],
  marches: ["create", "read", "update"],
  contracts: ["create", "read", "update"],
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
  clients: ["read"],
  suppliers: ["read"],
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
  clients: ["create", "read", "update"],
  products: ["read"],
  devis: ["create", "read", "update", "delete"],
  invoices: ["create", "read", "update"],
  payments: ["create", "read"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const PME_PURCHASES: ResourcePermissions = {
  suppliers: ["create", "read", "update"],
  products: ["read", "update"],
  commandes: ["create", "read", "update", "delete"],
  marches: ["create", "read", "update"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const PME_HR: ResourcePermissions = {
  employees: ["create", "read", "update", "delete"],
  payslips: ["create", "read", "update", "delete"],
  fiscalDeclarations: ["read"],
  documents: ["create", "read"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const PME_PROJECT_MANAGER: ResourcePermissions = {
  clients: ["read"],
  projects: ["create", "read", "update", "delete"],
  contracts: ["create", "read", "update"],
  marches: ["create", "read", "update"],
  documents: ["create", "read"],
  approbations: ["read"],
  notifications: ["read", "update"],
  supportTickets: ["create", "read"],
};

const PME_APPROVER: ResourcePermissions = {
  invoices: ["read"],
  commandes: ["read"],
  marches: ["read"],
  contracts: ["read"],
  approbations: ["read", "update"],
  notifications: ["read", "update"],
};

const PME_VIEWER: ResourcePermissions = {
  clients: ["read"],
  suppliers: ["read"],
  products: ["read"],
  devis: ["read"],
  invoices: ["read"],
  commandes: ["read"],
  payments: ["read"],
  marches: ["read"],
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
 * Vérifie si un rôle peut accéder à une ressource.
 * allowedResources surcharge individuelle (permissions additionnelles ou restreintes).
 */
export function canAccessResource(
  role: UserRole,
  resource: string,
  allowedResources?: string[]
): boolean {
  if (role === "superadmin") return true;

  // Surcharge individuelle
  if (allowedResources) {
    return allowedResources.includes(resource) || allowedResources.includes("*");
  }

  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  if (permissions["*"]) return true;

  return resource in permissions;
}

/**
 * Vérifie si un rôle peut effectuer une action CRUD sur une ressource.
 */
export function canPerformAction(
  role: UserRole,
  resource: string,
  action: Action
): boolean {
  if (role === "superadmin") return true;

  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  if (permissions["*"]) return true;

  const actions = permissions[resource];
  return actions?.includes(action) ?? false;
}

/**
 * Retourne les ressources accessibles par un rôle.
 */
export function getAccessibleResources(role: UserRole): string[] {
  if (role === "superadmin") return ["*"];
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return [];
  return Object.keys(permissions);
}

// Fusionnez le rôle transversal dans l'objet principal des permissions
const ALL_PERMISSIONS: Record<string, ResourcePermissions> = {
  ...ROLE_PERMISSIONS,
  chef_projet_transversal: CHEF_PROJET_TRANSVERSAL,
};

export { 
  ROLE_PERMISSIONS,
  CHEF_PROJET_TRANSVERSAL,
  ALL_PERMISSIONS 
};