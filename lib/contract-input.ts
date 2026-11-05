import { Types } from "mongoose";
import { ClientModel } from "@/models/Client";
import { SupplierModel } from "@/models/Supplier";
import { EmployeeModel } from "@/models/Employee";
import { MAX_RETENTION_RATE } from "@/lib/retention";

/**
 * Champs d'un contrat modifiables par l'utilisateur. Le reste (organisation,
 * référence, factures liées, devis et projet d'exécution, échéancier — routes
 * dédiées —, dates tenues par le système, auteur) ne vient jamais du corps.
 */
const EDITABLE = [
  "title", "type", "status", "clientId", "supplierId", "employeeId", "amount", "currency", "paymentMode",
  "isRecurring", "billingFrequency", "autoGenerateInvoice", "nextBillingDate", "startDate", "endDate", "signedDate",
  "renewalReminderDays", "documentIds", "description", "notes", "tags",
  // Retenue de garantie et réceptions.
  "retentionRate", "receptionProvisoireDate", "receptionDefinitiveDate", "guaranteeMonths",
  // Enregistrement (le constat et le paiement passent par leur route).
  "buyerType", "instrument", "approvalDate", "isSubcontract", "parentContractId", "pages", "fundingSource", "tvaRate",
  // Conditions financières du marché.
  "amountTTC", "paymentDays", "serviceOrderDate", "executionDelay", "executionUnit", "deliveredAt",
  "penaltyDivisor", "penaltyCapRate", "regulationRate", "regulationThreshold", "lateInterestRate",
] as const;

/** Conditions qui se vident : `null` efface la valeur (le calcul reprend le défaut). */
export const MARKET_TERMS = ["amountTTC", "paymentDays", "serviceOrderDate", "executionDelay", "executionUnit", "deliveredAt", "penaltyDivisor", "penaltyCapRate", "regulationRate", "regulationThreshold", "lateInterestRate"];

const CLEARABLE = ["amountTTC", "paymentDays", "serviceOrderDate", "executionDelay", "deliveredAt", "penaltyDivisor", "penaltyCapRate", "regulationRate", "regulationThreshold", "lateInterestRate"] as const;

const TERM_LIMITS: Array<[(typeof CLEARABLE)[number], number, number, string]> = [
  ["amountTTC", 0, Number.MAX_SAFE_INTEGER, "Montant TTC invalide."],
  ["paymentDays", 0, 365, "Délai de paiement : entre 0 et 365 jours."],
  ["executionDelay", 0, 3650, "Délai d'exécution invalide."],
  ["penaltyDivisor", 1, Number.MAX_SAFE_INTEGER, "Pénalité : indiquez le diviseur (2000 pour 1/2000e par jour)."],
  ["penaltyCapRate", 0, 1, "Plafond des pénalités invalide."],
  ["regulationRate", 0, 0.5, "Taux de redevance invalide."],
  ["regulationThreshold", 0, Number.MAX_SAFE_INTEGER, "Seuil de redevance invalide."],
  ["lateInterestRate", 0, 1, "Taux d'intérêts moratoires invalide."],
];

/** Sépare ce qui s'écrit de ce qui s'efface : `$set` ignore une valeur vide. */
export function contractUpdate(data: Record<string, unknown>) {
  const $set: Record<string, unknown> = {}, $unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(data)) {
    if ((v === null || v === undefined) && (CLEARABLE as readonly string[]).includes(k)) $unset[k] = 1;
    else $set[k] = v;
  }
  return { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
}

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
  if ("amount" in data && (data.amount === null || !(Number(data.amount) >= 0))) return { data, error: "Montant invalide." };
  if ("retentionRate" in data) {
    const r = Number(data.retentionRate ?? 0);
    if (!(r >= 0 && r <= MAX_RETENTION_RATE)) return { data, error: "Retenue de garantie : entre 0 et 10 %." };
    data.retentionRate = r;
  }
  if ("tvaRate" in data && data.tvaRate !== undefined && !(Number(data.tvaRate) >= 0 && Number(data.tvaRate) < 1)) return { data, error: "Taux de TVA invalide (fraction : 0,19)." };
  if ("parentContractId" in data && data.parentContractId) {
    const { ContractModel } = await import("@/models/Contract");
    if (!Types.ObjectId.isValid(String(data.parentContractId)) || !(await ContractModel.exists({ _id: data.parentContractId, tenantId }))) return { data, error: "Marché principal introuvable." };
  }
  if ("guaranteeMonths" in data && !(Number(data.guaranteeMonths) >= 0 && Number(data.guaranteeMonths) <= 60)) return { data, error: "Délai de garantie : entre 0 et 60 mois." };
  for (const [field, min, max, msg] of TERM_LIMITS) {
    const v = data[field];
    if (v === undefined || v === null) continue;
    const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
    if (!(n >= min && n <= max)) return { data, error: msg };
    if (["paymentDays", "executionDelay"].includes(field) && !Number.isInteger(n)) return { data, error: "Un délai se compte en nombre entier." };
    data[field] = n;
  }
  for (const field of ["serviceOrderDate", "deliveredAt"] as const) {
    const v = data[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v) || isNaN(new Date(v).getTime())) return { data, error: "Date invalide." };
    if (field === "deliveredAt" && new Date(v).getTime() > Date.now() + 86_400_000) return { data, error: "La livraison ne peut pas être dans le futur." };
  }
  if ("executionUnit" in data && data.executionUnit !== undefined && !["days", "months"].includes(String(data.executionUnit))) return { data, error: "Unité du délai : jours ou mois." };
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
