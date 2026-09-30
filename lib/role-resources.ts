import { UserRole } from "@/types";

/**
 * `approve` est une autorité distincte, pas un cas particulier de `update` :
 * un responsable qui n'a pas à corriger une note de frais doit pouvoir la
 * valider, et un comptable qui la corrige n'a pas forcément à l'approuver.
 * Les ressources qui ne la déclarent pas ne l'accordent à personne.
 */
type Action = "create" | "read" | "update" | "delete" | "approve";

/** Niveau d'un collaborateur dans un service : se règle pour chaque rôle attribué. */
export type RoleLevel = "chef" | "employe" | "stagiaire";
export type RoleLevels = Partial<Record<string, RoleLevel>>;
export const ROLE_LEVELS: RoleLevel[] = ["chef", "employe", "stagiaire"];

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
  // Lecture seule du stock : valorisation en fin d'exercice, contrôle des
  // écarts d'inventaire. Aucune entrée ni sortie possible.
  products: ["read"],
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
  // create : le responsable achats crée les nouveaux articles et lance les
  // inventaires physiques (tous deux exigent products:create), sans devoir
  // passer par l'administrateur. Pas de delete : supprimer un article reste
  // réservé à la direction.
  products: ["create", "read", "update"],
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

// ─── Services (organisation cloisonnée) ──────────────────────────────────────
//
// Un rôle par service ; le NIVEAU (chef / employé / stagiaire) se règle pour
// chaque rôle attribué (voir `canPerformAction`). Règle de base : seuls le
// gérant (pme_admin) et la comptabilité voient les informations financières —
// factures, encaissements, trésorerie, comptabilité, rentabilité, coûts et
// marges, paie. Les cartes ci-dessous sont celles d'un EMPLOYÉ ; le chef reçoit
// en plus CHEF_EXTRA et garde la suppression et la validation.

const CRUD: Action[] = ["create", "read", "update", "delete"];
const CRU: Action[] = ["create", "read", "update"];
const CR: Action[] = ["create", "read"];
const R: Action[] = ["read"];

/** Comptabilité : le seul service qui voit et produit l'information financière. */
const SVC_COMPTA: ResourcePermissions = {
  invoices: CRUD, payments: CRUD, treasuryAccounts: CRUD, accountingEntries: CRUD,
  fiscalDeclarations: CRUD, fixedAssets: CRUD, recurringCharges: CRUD, analytics: CRUD,
  isicFinance: CRUD, comptoir: CRUD, subscriptions: R,
  expenses: ["create", "read", "update", "approve"],
  // Le devis accepté est transformé en facture par la comptabilité.
  devis: ["read", "update"],
  clients: R, suppliers: R, commandes: R, products: R, livraisons: R, deliveries: R,
  projects: R, contracts: R, publicTenders: R, appels: R, isic: R, events: R,
  // Dossiers des collaborateurs SANS salaires (visibles avec la paie : chef).
  employees: R,
  documents: CRU, approbations: CRU, supportTickets: CR, auditLogs: R,
};

/** Administration : vente de matériel et mobilier, achats, stock, appels d'offres, dossiers RH. */
const SVC_ADMIN: ResourcePermissions = {
  clients: CRUD, devis: CRUD, suppliers: CRUD, commandes: CRUD, products: CRUD,
  livraisons: CRUD, deliveries: CRUD, publicTenders: CRUD, appels: CRUD,
  documents: CRUD, employees: CRUD, projects: CRUD, contracts: R, events: R,
  expenses: CR, approbations: CRU, supportTickets: CR,
};

/** Communication, pour l'entreprise et pour les clients. */
const SVC_COMM: ResourcePermissions = {
  clients: CRU, devis: CRUD, projects: CRUD, documents: CRUD, events: CRUD,
  appels: R, publicTenders: R, expenses: CR, approbations: CRU, supportTickets: CR,
};

/** Développement logiciel : projets, abonnements et licences (sans montants), support. */
const SVC_DEV: ResourcePermissions = {
  clients: CRU, devis: CRUD, projects: CRUD, documents: CRUD, supportTickets: CRUD,
  subscriptions: ["read", "update"], contracts: R, appels: R, publicTenders: R,
  auditLogs: R, events: R, expenses: CR, approbations: CRU,
};

/** Production & Cartes : production, cartes ISIC et Easypay (sans les coûts ISIC). */
const SVC_PROD: ResourcePermissions = {
  isic: CRUD, projects: CRUD, devis: CRUD, clients: CRU, documents: CRUD,
  products: ["read", "update"], suppliers: R, commandes: CR, appels: R, events: R,
  expenses: CR, approbations: CRU, supportTickets: CR,
};

/** The Spot : comptoirs (stock matière, saisie de caisse), limités aux sites attribués. */
const SVC_SPOT: ResourcePermissions = {
  comptoir: CRUD, documents: R, events: R, expenses: CR, supportTickets: CR,
};

/** Prospection : prospects et CRM, devis, veille et candidatures aux appels d'offres. */
const SVC_PROSP: ResourcePermissions = {
  clients: CRU, devis: CRUD, appels: CRUD, publicTenders: R, projects: R, documents: CRU,
  events: R, expenses: CR, approbations: CRU, supportTickets: CR,
};

/**
 * Sécurité : contrôle des accès PHYSIQUES aux locaux et aux sites. Dans
 * l'application, accès minimal : consignes et documents en lecture, contrôle
 * des billets à l'entrée des événements (`eventCheckin`, sans pouvoir modifier
 * les événements), ses notes de frais.
 */
const SVC_SECU: ResourcePermissions = {
  eventCheckin: ["read", "update"], events: R, documents: R, expenses: CR, supportTickets: CR,
};

/** Droits propres au chef de service, en plus de la carte de l'employé. */
const CHEF_EXTRA: Partial<Record<UserRole, ResourcePermissions>> = {
  // Paie : chef comptable et gérant uniquement.
  svc_compta: { payslips: CRUD, employees: ["read", "update"] },
  // Chaque chef valide les notes de frais de son équipe (1er niveau).
  svc_admin: { expenses: ["approve"] },
  svc_comm: { expenses: ["approve"] },
  svc_dev: { expenses: ["approve"] },
  svc_prod: { expenses: ["approve"] },
  svc_spot: { expenses: ["approve"] },
  svc_prosp: { expenses: ["approve"] },
  svc_secu: { expenses: ["approve"] },
};

/**
 * Actions retirées par niveau (rôles de service uniquement) : seul le chef
 * supprime et valide. Exception : le comptable rembourse les notes de frais
 * (c'est son métier), ce qui passe par l'action `approve`.
 */
const LEVEL_DENY: Record<RoleLevel, Action[]> = { chef: [], employe: ["delete", "approve"], stagiaire: ["delete", "approve"] };
const EMPLOYEE_KEEPS: Partial<Record<UserRole, ResourcePermissions>> = { svc_compta: { expenses: ["approve"] } };

export const SERVICE_ROLES = ["svc_admin", "svc_comm", "svc_prosp", "svc_dev", "svc_prod", "svc_spot", "svc_secu", "svc_compta"] as const satisfies readonly UserRole[];
export function isServiceRole(role: string): boolean {
  return (SERVICE_ROLES as readonly string[]).includes(role);
}

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
  // Rôles ISIC dédiés : accès étroit. Les ressources isic / isicFinance leur
  // sont ajoutées par les boucles ci-dessous.
  pme_isic_operator: { notifications: ["read"] },
  pme_isic_finance: { notifications: ["read"] },
  // Gestionnaire de comptoir d'activité (The Spot) : accès étroit, borné au
  // comptoir (stock matière + caisse). La ressource `comptoir` lui est ajoutée
  // par la boucle ci-dessous.
  pme_activity_manager: { notifications: ["read"] },
  // Services (organisation cloisonnée)
  svc_admin: SVC_ADMIN,
  svc_comm: SVC_COMM,
  svc_dev: SVC_DEV,
  svc_prod: SVC_PROD,
  svc_spot: SVC_SPOT,
  svc_compta: SVC_COMPTA,
  svc_prosp: SVC_PROSP,
  svc_secu: SVC_SECU,
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
 * Contrôle d'entrée (scan des billets) : droit distinct de la modification des
 * événements, pour qu'un agent de sécurité contrôle les entrées sans pouvoir
 * modifier l'événement. Accordé à tous ceux qui gèrent déjà les événements.
 */
for (const perms of Object.values(ROLE_PERMISSIONS)) {
  if (perms.events?.includes("update") && !perms.eventCheckin) perms.eventCheckin = ["read", "update"];
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

/** Appels à candidatures (réponse à appels d'offres) : accordé largement. */
const APPELS_ALL: Action[] = ["create", "read", "update", "delete"];
for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
  if (isServiceRole(role)) continue; // les services déclarent leur accès aux appels
  // (la Comptabilité et The Spot n'ont pas à les modifier).
  perms.appels = APPELS_ALL;
}

/**
 * Comptabilité analytique (rentabilité par secteur) : rôles de gestion et de
 * finance uniquement. La vue consolidée (santé financière d'ensemble) est en
 * plus réservée aux administrateurs, contrôlée dans l'endpoint de rapport.
 */
for (const role of ["pme_admin", "pme_manager", "pme_accountant", "asso_president", "asso_treasurer", "admin_ordonnateur", "admin_daf", "superadmin"] as UserRole[]) {
  const p = ROLE_PERMISSIONS[role];
  if (p) p.analytics = ["create", "read", "update", "delete"];
}

/**
 * Ordonnateur = administrateur de l'espace Administration (il figure dans
 * TENANT_ADMIN_ROLES, la garde anti-verrouillage et l'API de création de
 * comptes ; sa fiche dit « gère les comptes et les rôles »). Ses permissions ne
 * suivaient pas : `users` en lecture seule et aucun `companies`, si bien que
 * dans une administration personne ne pouvait créer un compte, changer un rôle
 * ni régler la fiche organisation et la charte des documents. On l'aligne sur
 * le président d'association.
 */
{
  const p = ROLE_PERMISSIONS.admin_ordonnateur;
  p.users = ["create", "read", "update", "delete"];
  p.companies = ["read", "update"];
}

/**
 * Services citoyens : le lien figure dans la navigation « administration »
 * (non filtrée par rôle). Sans accès, un rôle non-ordonnateur cliquait sur un
 * lien visible et recevait 403. On accorde au moins la lecture à tous les rôles
 * administration ; l'ordonnateur conserve la gestion complète.
 */
for (const role of ["admin_daf", "admin_public_accountant", "admin_procurement_officer", "admin_procurement_commission", "admin_viewer"] as UserRole[]) {
  const p = ROLE_PERMISSIONS[role];
  if (p && !p.services) p.services = ["read"];
}

/**
 * Module ISIC — droits fins pour séparer production et finances :
 * - `isic` (production, impression, livraison, fichiers) : rôles opérationnels.
 * - `isicFinance` (coûts, revente, marge, encaissements) : rôles financiers.
 * Ainsi l'opérateur qui imprime ne voit pas les montants, et le financier voit
 * le volet argent. On assigne le rôle correspondant sur l'écran Utilisateurs.
 */
const ISIC_ALL: Action[] = ["create", "read", "update", "delete"];
const ISIC_OPS_ROLES: UserRole[] = ["pme_admin", "pme_manager", "pme_sales", "pme_purchases", "pme_project_manager", "pme_isic_operator", "pme_isic_finance", "superadmin"];
const ISIC_FINANCE_ROLES: UserRole[] = ["pme_admin", "pme_manager", "pme_accountant", "pme_isic_finance", "superadmin"];
for (const r of ISIC_OPS_ROLES) { if (ROLE_PERMISSIONS[r]) ROLE_PERMISSIONS[r].isic = ISIC_ALL; }
for (const r of ISIC_FINANCE_ROLES) { if (ROLE_PERMISSIONS[r]) ROLE_PERMISSIONS[r].isicFinance = ISIC_ALL; }

/**
 * Comptoir d'activité (The Spot) — comptabilité matière (stock) + caisse.
 * Confié au gestionnaire dédié, ET supervisé par le comptable principal et la
 * direction (« en plus du comptable principal »). Un gestionnaire de comptoir
 * n'a pas accès au reste de la comptabilité : sa vue s'arrête au comptoir.
 */
const COMPTOIR_ALL: Action[] = ["create", "read", "update", "delete"];
const COMPTOIR_ROLES: UserRole[] = ["pme_admin", "pme_manager", "pme_accountant", "pme_activity_manager", "superadmin"];
for (const r of COMPTOIR_ROLES) { if (ROLE_PERMISSIONS[r]) ROLE_PERMISSIONS[r].comptoir = COMPTOIR_ALL; }

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
/** Actions d'un rôle sur une ressource, niveau compris (rôles de service). */
function actionsFor(role: UserRole, resource: string, level?: RoleLevel): Action[] {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return [];
  if (!isServiceRole(role)) return permissions[resource] ?? [];
  const lvl: RoleLevel = level ?? "employe";
  const base = [...(permissions[resource] ?? [])];
  if (lvl === "chef") base.push(...(CHEF_EXTRA[role]?.[resource] ?? []));
  const keeps = lvl === "employe" ? (EMPLOYEE_KEEPS[role]?.[resource] ?? []) : [];
  return [...new Set(base)].filter(a => !LEVEL_DENY[lvl].includes(a) || keeps.includes(a));
}

/**
 * Vérifie si un rôle peut accéder à une ressource.
 */
export function canAccessResource(
  role: UserRole,
  resource: string,
  allowedResources?: string[],
  level?: RoleLevel,
): boolean {
  if (role === "superadmin") return true;
  if (!withinAllowList(resource, allowedResources)) return false;
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  if (permissions["*"]) return true;
  return actionsFor(role, resource, level).length > 0;
}

/**
 * Vérifie si un rôle peut effectuer une action sur une ressource.
 *
 * `allowedResources` est pris en compte ici aussi : les deux fonctions doivent
 * répondre la même chose, sans quoi l'interface affiche ce que l'API refuse.
 * `level` ne concerne que les rôles de service (défaut : employé).
 */
export function canPerformAction(
  role: UserRole,
  resource: string,
  action: Action,
  allowedResources?: string[],
  level?: RoleLevel,
): boolean {
  if (role === "superadmin") return true;
  if (!withinAllowList(resource, allowedResources)) return false;
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  if (permissions["*"]) return true;
  return actionsFor(role, resource, level).includes(action);
}

/**
 * Retourne les ressources accessibles par un rôle, éventuellement réduites par
 * la liste individuelle.
 */
export function getAccessibleResources(role: UserRole, allowedResources?: string[], level?: RoleLevel): string[] {
  if (role === "superadmin") return ["*"];
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return [];
  const keys = new Set(Object.keys(permissions));
  if (isServiceRole(role) && (level ?? "employe") === "chef") for (const k of Object.keys(CHEF_EXTRA[role] ?? {})) keys.add(k);
  return [...keys].filter(r => withinAllowList(r, allowedResources) && actionsFor(role, r, level).length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-rôle — un collaborateur peut cumuler plusieurs rôles (chef du service
// Communication ET employé du service Développement). Les permissions
// s'évaluent en UNION, chaque rôle avec SON niveau. Les versions à rôle unique
// restent le cas particulier `[role]`.
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise en tableau non vide : `roles` s'il est fourni, sinon `[role]`. */
export function effectiveRoles(role: UserRole, roles?: UserRole[] | null): UserRole[] {
  return roles && roles.length > 0 ? roles : [role];
}

export function rolesCanPerform(
  roles: UserRole[], resource: string, action: Action, allowedResources?: string[], levels?: RoleLevels,
): boolean {
  return roles.some(r => canPerformAction(r, resource, action, allowedResources, levels?.[r]));
}

export function rolesCanAccess(
  roles: UserRole[], resource: string, allowedResources?: string[], levels?: RoleLevels,
): boolean {
  return roles.some(r => canAccessResource(r, resource, allowedResources, levels?.[r]));
}

/** Union des ressources accessibles par l'ensemble des rôles. */
export function accessibleResourcesForRoles(roles: UserRole[], allowedResources?: string[], levels?: RoleLevels): string[] {
  if (roles.includes("superadmin")) return ["*"];
  const set = new Set<string>();
  for (const role of roles) {
    for (const r of getAccessibleResources(role, allowedResources, levels?.[role])) set.add(r);
  }
  return [...set];
}

/**
 * Meilleur niveau avec lequel l'utilisateur peut agir sur une ressource
 * (chef > employé > stagiaire). Un rôle hors service (gérant, anciens rôles)
 * compte comme « chef ». null si aucun rôle ne le permet.
 */
export function bestLevelFor(
  roles: UserRole[], resource: string, action: Action, allowedResources?: string[], levels?: RoleLevels,
): RoleLevel | null {
  const order: RoleLevel[] = ["chef", "employe", "stagiaire"];
  let best: RoleLevel | null = null;
  for (const r of roles) {
    const lvl: RoleLevel = isServiceRole(r) ? (levels?.[r] ?? "employe") : "chef";
    if (!canPerformAction(r, resource, action, allowedResources, levels?.[r])) continue;
    if (best === null || order.indexOf(lvl) < order.indexOf(best)) best = lvl;
  }
  return best;
}

/** Contexte d'autorisation minimal (jeton revalidé). */
export interface AuthLike { role: string; roles?: string[] | null; allowedResources?: string[]; roleLevels?: RoleLevels }

/** L'utilisateur peut-il … ? Tous ses rôles, chacun avec son niveau. */
export function authCan(auth: AuthLike, resource: string, action: Action = "read"): boolean {
  return rolesCanPerform(effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined), resource, action, auth.allowedResources, auth.roleLevels);
}

/** Accès aux informations financières : gérant et comptabilité uniquement. */
export function hasFinanceAccess(auth: AuthLike): boolean {
  return authCan(auth, "accountingEntries", "read");
}

export {
  ROLE_PERMISSIONS,
  CHEF_PROJET_TRANSVERSAL,
};

/**
 * Stagiaire pour cette ressource : aucun de ses rôles ne lui donne un niveau
 * supérieur. Sert à bloquer les exports et les envois vers l'extérieur.
 */
export function isInternFor(auth: AuthLike, resource: string): boolean {
  const roles = effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined);
  return bestLevelFor(roles, resource, "read", auth.allowedResources, auth.roleLevels) === "stagiaire";
}

export const INTERN_EXPORT_MESSAGE = "Les stagiaires ne peuvent pas exporter ni envoyer de fichiers : demandez à votre chef de service.";
