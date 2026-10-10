import { Types } from "mongoose";
import { ClientModel } from "@/models/Client";
import { SupplierModel } from "@/models/Supplier";
import { EmployeeModel } from "@/models/Employee";

/**
 * Champs d'un contrat modifiables par l'utilisateur. Le reste (organisation,
 * référence, factures liées, devis et projet d'exécution, échéancier — routes
 * dédiées —, dates tenues par le système, auteur) ne vient jamais du corps.
 */
const EDITABLE = [
  "title", "type", "status", "clientId", "supplierId", "employeeId", "amount", "currency", "paymentMode",
  "isRecurring", "billingFrequency", "autoGenerateInvoice", "nextBillingDate", "startDate", "endDate", "signedDate",
  "renewalReminderDays", "documentIds", "description", "notes", "tags",
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

/**
 * Échéance d'un marché : libellé, montant HT (ou pourcentage du marché), acompte
 * ou facturation ordinaire, date prévue. Le statut et la facture liée sont tenus
 * par la facturation, jamais saisis.
 */
export function parseMilestone(body: Record<string, unknown>, contractAmount: number): { data?: { label: string; amount: number; kind: "deposit" | "standard"; dueDate?: Date }; error?: string } {
  const label = String(body.label ?? "").trim().slice(0, 200);
  if (!label) return { error: "Libellé de l'échéance obligatoire." };
  const amount = body.amount !== undefined && body.amount !== "" ? Math.round(Number(body.amount))
    : body.rate !== undefined && body.rate !== "" ? Math.round(contractAmount * Number(body.rate) / 100) : NaN;
  if (!(amount > 0)) return { error: "Montant (ou pourcentage) de l'échéance invalide." };
  const dueDate = body.dueDate ? new Date(String(body.dueDate)) : undefined;
  if (dueDate && isNaN(dueDate.getTime())) return { error: "Date d'échéance invalide." };
  return { data: { label, amount, kind: body.kind === "deposit" ? "deposit" : "standard", ...(dueDate ? { dueDate } : {}) } };
}
