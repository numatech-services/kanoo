/**
 * Libellés lisibles des ressources RBAC, pour l'écran de synthèse des accès.
 * Une ressource absente de la table s'affiche telle quelle (sa clé technique).
 */
export const RESOURCE_LABELS: Record<string, string> = {
  "*": "Tout (superadmin)",
  // Ventes / achats
  clients: "Clients", suppliers: "Fournisseurs", products: "Produits & stock",
  devis: "Devis", invoices: "Factures", deliveries: "Bons de livraison", livraisons: "Bons de livraison",
  commandes: "Commandes", payments: "Paiements", contracts: "Contrats", subscriptions: "Abonnements",
  publicTenders: "Marchés / appels d'offres", companies: "Société", appels: "Appels à candidatures",
  // Finance
  treasuryAccounts: "Trésorerie", accountingEntries: "Comptabilité", recurringCharges: "Charges récurrentes",
  fiscalDeclarations: "Fiscalité", fixedAssets: "Immobilisations", expenses: "Notes de frais",
  budgetChapters: "Budget (administration)",
  // RH
  employees: "Collaborateurs", payslips: "Bulletins de paie",
  // Projets / documents
  projects: "Projets", documents: "Documents", approbations: "Approbations",
  // Associations
  cotisations: "Cotisations", memberships: "Cotisations", donations: "Dons", dons: "Dons",
  membres: "Adhérents", assemblee: "Assemblées générales", bureau: "Bureau",
  // Transversal
  notifications: "Notifications", supportTickets: "Support", auditLogs: "Journal d'audit",
  users: "Utilisateurs", events: "Activités / billetterie", agenda: "Agenda", messages: "Messagerie",
  // ISIC
  isic: "Cartes ISIC — production", isicFinance: "Cartes ISIC — finances",
  analytics: "Comptabilité analytique (rentabilité par secteur)",
};

export const resourceLabel = (key: string): string => RESOURCE_LABELS[key] || key;
