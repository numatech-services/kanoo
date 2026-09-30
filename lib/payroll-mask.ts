import { authCan, hasFinanceAccess, type AuthLike } from "@/lib/role-resources";

/**
 * Rémunération d'un collaborateur : visible et modifiable seulement par qui a
 * accès à la paie (chef comptable, gérant). Le service Administration gère le
 * dossier (identité, contrat, poste) sans voir ni fixer les montants.
 */
export const PAYROLL_FIELDS = [
  "grossSalary", "indemnity", "indemnityPeriod", "otherDeductionLabel", "otherDeductionAmount",
  "bankAccount", "bankName", "paymentTreasuryAccountId", "includeCnss", "includeIr",
] as const;

export function canSeePayroll(auth: AuthLike): boolean {
  return authCan(auth, "payslips", "read");
}

export function maskPayroll<T extends Record<string, unknown>>(doc: T, auth: AuthLike): T {
  if (canSeePayroll(auth)) return doc;
  const copy: Record<string, unknown> = { ...doc };
  for (const f of PAYROLL_FIELDS) delete copy[f];
  copy.payrollHidden = true;
  return copy as T;
}

/** Retire les champs de rémunération d'une écriture faite sans accès à la paie. */
export function stripPayrollWrites(body: Record<string, unknown>, auth: AuthLike): Record<string, unknown> {
  if (canSeePayroll(auth)) return body;
  const copy = { ...body };
  for (const f of PAYROLL_FIELDS) delete copy[f];
  return copy;
}

/**
 * Montants d'un document (coût, prix, frais, marge, totaux) retirés pour qui
 * n'a pas accès aux finances — ex. le service Développement suit les
 * abonnements et licences sans voir ce qu'ils coûtent ni rapportent.
 */
const MONEY_KEY = /(amount|price|cost|fee|margin|total|tva|vat|withholding)/i;
export function maskMoney<T extends Record<string, unknown>>(doc: T, auth: AuthLike): T {
  if (hasFinanceAccess(auth)) return doc;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!MONEY_KEY.test(k)) copy[k] = v;
  copy.amountsHidden = true;
  return copy as T;
}

/**
 * Projets : budget, dépensé, montants de jalons — informations financières.
 * Le suivi (tâches, équipe, avancement physique) reste ouvert au service.
 */
const PROJECT_MONEY = ["budget", "spentAmount", "budgetRate", "amount"] as const;

export function maskProjectMoney<T extends Record<string, unknown>>(doc: T, auth: AuthLike): T {
  if (hasFinanceAccess(auth)) return doc;
  const copy: Record<string, unknown> = { ...doc };
  for (const f of PROJECT_MONEY) delete copy[f];
  if (Array.isArray(copy.milestones)) {
    copy.milestones = (copy.milestones as Array<Record<string, unknown>>).map(({ amount: _a, invoiceId: _i, ...m }) => m);
  }
  copy.amountsHidden = true;
  return copy as T;
}

/** Retire les montants d'une écriture de projet faite sans accès aux finances. */
export function stripProjectMoneyWrites(body: Record<string, unknown>, auth: AuthLike): Record<string, unknown> {
  if (hasFinanceAccess(auth)) return body;
  const copy = { ...body };
  for (const f of PROJECT_MONEY) delete copy[f];
  // Jalons : modifiables, mais sans montant ni facture liée (la route recopie
  // ceux déjà enregistrés, pour ne pas les effacer).
  if (Array.isArray(copy.milestones)) {
    copy.milestones = (copy.milestones as Array<Record<string, unknown>>).map(({ amount: _a, invoiceId: _i, ...m }) => m);
  }
  return copy;
}
