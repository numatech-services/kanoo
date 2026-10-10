import { Types } from "mongoose";
import { ClientModel } from "@/models/Client";
import { SupplierModel } from "@/models/Supplier";
import { EmployeeModel } from "@/models/Employee";

/**
 * Champs d'un contrat modifiables par l'utilisateur. Le reste (organisation,
 * référence, factures liées, dates de facturation tenues par le système,
 * auteur) ne vient jamais du corps de la requête.
 */
const EDITABLE = [
  "title", "type", "status", "clientId", "supplierId", "employeeId", "amount", "currency", "paymentMode",
  "isRecurring", "billingFrequency", "autoGenerateInvoice", "nextBillingDate", "startDate", "endDate", "signedDate",
  "renewalReminderDays", "milestones", "documentIds", "description", "notes", "tags",
] as const;

/** Champs autorisés du corps, et refus si une partie liée n'appartient pas à l'organisation. */
export async function contractFields(tenantId: string, body: Record<string, unknown>): Promise<{ data: Record<string, unknown>; error?: string }> {
  const data: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) data[k] = body[k] === "" ? undefined : body[k];
  const checks: Array<[string, { exists: (f: object) => unknown }, string]> = [
    ["clientId", ClientModel, "Client introuvable."],
    ["supplierId", SupplierModel, "Fournisseur introuvable."],
    ["employeeId", EmployeeModel, "Salarié introuvable."],
  ];
  for (const [field, model, msg] of checks) {
    const v = data[field];
    if (v === undefined || v === null) continue;
    if (!Types.ObjectId.isValid(String(v)) || !(await model.exists({ _id: v, tenantId }))) return { data, error: msg };
  }
  if ("amount" in data && !(Number(data.amount) >= 0)) return { data, error: "Montant invalide." };
  return { data };
}
