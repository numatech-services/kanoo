/**
 * Ressource RBAC requise par chaque écran, pour masquer dans la navigation
 * (barre latérale, palette ⌘K) ce qu'un rôle ne peut pas ouvrir.
 *
 * Règle de sûreté : un écran absent de la table reste **toujours visible**
 * (universel : agenda, messagerie, profil, réglages…). On ne masque jamais par
 * erreur, on ne masque que ce qu'on sait inaccessible.
 */
export const NAV_RESOURCE: Record<string, string> = {
  // PME — Ventes
  "/clients": "clients", "/crm": "clients", "/devis": "devis", "/invoices": "invoices",
  "/livraisons": "livraisons", "/payments": "payments", "/relances": "invoices",
  "/notes-de-frais": "expenses", "/isic": "isic",
  // PME — Achats & stock
  "/suppliers": "suppliers", "/commandes": "commandes", "/stock": "products",
  "/inventaires": "products", "/marches": "publicTenders", "/marches-cadres": "commandes",
  // PME — Abonnements
  "/abonnements": "subscriptions",
  // PME — Contrats & projets
  "/appels": "appels", "/contracts": "contracts", "/projects": "projects",
  "/documents": "documents", "/documents-administratifs": "documents", "/approbations": "approbations",
  // PME — Finance
  "/treasury": "treasuryAccounts", "/accounting": "accountingEntries", "/comptoir": "comptoir",
  "/analytique": "analytics", "/analytics": "analytics", "/budget-previsionnel": "accountingEntries",
  "/recurring-expenses": "recurringCharges", "/fiscalite": "fiscalDeclarations",
  "/fixed-assets": "fixedAssets",
  // PME — RH & courriers
  "/employees": "employees", "/payslips": "payslips", "/courriers": "documents",
  // Paramètres réservés à l'administration du compte. Sécurité (2FA),
  // confidentialité, import/export et support restent universels.
  "/users": "users", "/audit": "auditLogs",
  "/company": "companies", "/subscription": "companies",
  "/settings/numbering": "companies", "/settings/facture-certifiee": "companies",
  // Associations
  "/associations/bureau": "bureau", "/associations/assemblee": "assemblee",
  "/associations/membres": "membres", "/associations/cotisations": "cotisations",
  "/associations/dons": "dons",
  // Administration
  "/administration/budget": "budgetChapters", "/administration/marches-publics": "publicTenders",
  "/administration/recettes": "publicRevenues", "/administration/services": "services",
  // Activités (billetterie) — largement accordé mais pas aux rôles ultra-étroits
  "/activites": "events",
};

/**
 * Ressource d'un lien : correspondance au plus long préfixe, requête ignorée.
 * « /invoices/new » et « /invoices?overdue=true » relèvent de `invoices`.
 */
export function resourceForHref(href: string): string | undefined {
  const path = href.split("?")[0];
  let best: string | undefined;
  let bestLen = -1;
  for (const [prefix, res] of Object.entries(NAV_RESOURCE)) {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && prefix.length > bestLen) {
      best = res; bestLen = prefix.length;
    }
  }
  return best;
}
