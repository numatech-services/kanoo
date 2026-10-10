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
    case "fiscal_reminder": return "/fiscalite";
  }
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
