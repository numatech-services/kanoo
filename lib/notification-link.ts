/**
 * Écran vers lequel mène une notification. Les notifications n'étaient pas
 * cliquables : « Facture en retard » ne menait nulle part. On se fonde d'abord
 * sur le type (fiable), puis sur `linkedTo` pour les notifications génériques.
 */
export function notificationHref(n: { type?: string; linkedTo?: string; linkedId?: string | null }): string | null {
  const id = n.linkedId ? String(n.linkedId) : "";
  switch (n.type) {
    case "invoice_overdue": return id ? `/invoices/${id}` : "/invoices";
    case "stock_alert": return n.linkedTo === "comptoir" ? "/comptoir" : n.linkedTo === "stock_lots" ? "/stock/lots" : "/stock?alertOnly=true";
    case "courrier_due": return "/courriers";
    case "admin_document": return "/documents-administratifs";
    case "contract_expiry": return id ? `/contracts/${id}` : "/contracts";
    case "employee_contract_expiry": return id ? `/employees/${id}` : "/employees";
    case "expense_due": return "/recurring-expenses";
    case "crm_followup": return "/crm";
    case "subscription_alert": return "/abonnements";
    case "fiscal_reminder": return n.linkedTo && /^\/fiscalite\//.test(n.linkedTo) ? n.linkedTo : "/fiscalite";
    case "guarantee_expiry": return "/cautions";
    case "retention_claimable": return id ? `/contracts/${id}` : "/contracts";
    case "registration_due": return id ? `/contracts/${id}` : n.linkedTo && /^\/contracts\/[a-f0-9]{24}$/.test(n.linkedTo) ? n.linkedTo : "/contracts";
    case "tender_deadline": return id ? `/appels/${id}` : "/appels";
    // Automatisations (lib/automation-jobs.ts).
    case "depreciation_posted": return "/fixed-assets";
    case "treasury_alert": return "/treasury/prevision";
    case "payroll_reminder": case "payroll_generated": return "/payslips";
    case "accountant_packet": return "/accounting";
    case "approval_reminder": return "/approbations";
    case "budget_alert": return n.linkedTo === "budget" ? "/administration/budget" : "/budget-previsionnel";
    case "accounting_checks": return "/accounting/etats";
    case "supplier_payments": return "/depenses/echeancier";
    case "tender_followup": return id ? `/appels/${id}` : "/appels";
  }
  // Lien profond posé par une automatisation (comptoir et onglet, mois de TVA…) :
  // chemin interne uniquement, jamais une adresse extérieure.
  if (n.linkedTo && /^\/[a-z]/.test(n.linkedTo) && !n.linkedTo.startsWith("//")) return n.linkedTo;
  switch (n.linkedTo) {
    case "invoices": return id ? `/invoices/${id}` : "/invoices";
    case "approbations": return "/approbations";
    case "comptoir": return "/comptoir";
    case "documents": return "/courriers";
    case "contracts": return id ? `/contracts/${id}` : "/contracts";
    case "stock": return "/stock";
    case "stock_lots": return "/stock/lots";
    case "leaves": return "/conges";
    case "expenses": return id ? `/notes-de-frais/${id}` : "/notes-de-frais";
  }
  return null;
}
